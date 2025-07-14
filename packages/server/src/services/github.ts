import * as os from "os";
import * as path from "path";
import { db } from "@dokploy/server/db";
import {
	type apiCreateGithub,
	gitProvider,
	github,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as fs from "fs/promises";
import { nanoid } from "nanoid";
import { simpleGit } from "simple-git";
import { authGithub } from "../utils/providers/github";
import { updatePreviewDeployment } from "./preview-deployment";

export type Github = typeof github.$inferSelect;
export const createGithub = async (
	input: typeof apiCreateGithub._type,
	organizationId: string,
	userId: string,
) => {
	return await db.transaction(async (tx) => {
		const newGitProvider = await tx
			.insert(gitProvider)
			.values({
				providerType: "github",
				organizationId: organizationId,
				name: input.name,
				userId: userId,
			})
			.returning()
			.then((response) => response[0]);

		if (!newGitProvider) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the Git provider",
			});
		}

		return await tx
			.insert(github)
			.values({
				...input,
				gitProviderId: newGitProvider?.gitProviderId,
			})
			.returning()
			.then((response) => response[0]);
	});
};

export const findGithubById = async (githubId: string) => {
	const githubProviderResult = await db.query.github.findFirst({
		where: eq(github.githubId, githubId),
		with: {
			gitProvider: true,
		},
	});

	if (!githubProviderResult) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Github Provider not found",
		});
	}

	return githubProviderResult;
};

export const updateGithub = async (
	githubId: string,
	input: Partial<Github>,
) => {
	return await db
		.update(github)
		.set({
			...input,
		})
		.where(eq(github.githubId, githubId))
		.returning()
		.then((response) => response[0]);
};

export const getIssueComment = (
	appName: string,
	status: "success" | "error" | "running" | "initializing",
	previewDomain: string,
) => {
	let statusMessage = "";
	if (status === "success") {
		statusMessage = "✅ Done";
	} else if (status === "error") {
		statusMessage = "❌ Failed";
	} else if (status === "initializing") {
		statusMessage = "🔄 Building";
	} else {
		statusMessage = "🔄 Building";
	}
	const finished = `
| Name       | Status       | Preview                             | Updated (UTC)         |
|------------|--------------|-------------------------------------|-----------------------|
| ${appName}  | ${statusMessage} | [Preview URL](${previewDomain}) | ${new Date().toISOString()} |
`;

	return finished;
};
interface CommentExists {
	owner: string;
	repository: string;
	comment_id: number;
	githubId: string;
}
export const issueCommentExists = async ({
	owner,
	repository,
	comment_id,
	githubId,
}: CommentExists) => {
	const github = await findGithubById(githubId);
	const octokit = authGithub(github);
	try {
		await octokit.rest.issues.getComment({
			owner: owner || "",
			repo: repository || "",
			comment_id: comment_id,
		});
		return true;
	} catch {
		return false;
	}
};
interface Comment {
	owner: string;
	repository: string;
	issue_number: string;
	body: string;
	comment_id: number;
	githubId: string;
}
export const updateIssueComment = async ({
	owner,
	repository,
	issue_number,
	body,
	comment_id,
	githubId,
}: Comment) => {
	const github = await findGithubById(githubId);
	const octokit = authGithub(github);

	await octokit.rest.issues.updateComment({
		owner: owner || "",
		repo: repository || "",
		issue_number: issue_number,
		body,
		comment_id: comment_id,
	});
};

interface CommentCreate {
	appName: string;
	owner: string;
	repository: string;
	issue_number: string;
	previewDomain: string;
	githubId: string;
	previewDeploymentId: string;
}

export const createPreviewDeploymentComment = async ({
	owner,
	repository,
	issue_number,
	previewDomain,
	appName,
	githubId,
	previewDeploymentId,
}: CommentCreate) => {
	const github = await findGithubById(githubId);
	const octokit = authGithub(github);

	const runningComment = getIssueComment(
		appName,
		"initializing",
		previewDomain,
	);

	const issue = await octokit.rest.issues.createComment({
		owner: owner || "",
		repo: repository || "",
		issue_number: Number.parseInt(issue_number),
		body: `### Dokploy Preview Deployment\n\n${runningComment}`,
	});

	return await updatePreviewDeployment(previewDeploymentId, {
		pullRequestCommentId: `${issue.data.id}`,
	}).then((response) => response[0]);
};

export interface GitHubRepositoryInfo {
	owner: string;
	repo: string;
	branch?: string;
	isPrivate?: boolean;
}

export class GitHubService {
	/**
	 * Parses a GitHub URL to extract repository information
	 * @param githubUrl The URL of the GitHub repository
	 * @returns Repository information
	 */
	static parseGitHubUrl(githubUrl: string): GitHubRepositoryInfo {
		try {
			const url = new URL(githubUrl);
			if (url.hostname !== "github.com") {
				throw new Error("Invalid GitHub URL");
			}

			const pathParts = url.pathname.split("/").filter(Boolean);
			if (pathParts.length < 2) {
				throw new Error("Invalid GitHub repository URL");
			}

			const [owner, repo] = pathParts;
			const branch = url.searchParams.get("branch") || "main";

			return {
				owner: owner!,
				repo: repo!.replace(/\.git$/, ""), // Remove .git suffix if present
				branch,
			};
		} catch (error) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Invalid GitHub URL: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Clones a public GitHub repository to a temporary directory
	 * @param repoUrl The URL of the GitHub repository
	 * @param branch Optional branch to clone (defaults to main)
	 * @returns The local path to the cloned repository
	 */
	static async clonePublicRepository(
		repoUrl: string,
		branch?: string,
	): Promise<string> {
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), `gitagent-${nanoid(6)}-`),
		);
		const git = simpleGit();

		try {
			const repoInfo = this.parseGitHubUrl(repoUrl);
			const targetBranch = branch || repoInfo.branch || "main";

			await git.clone(repoUrl, tempDir, [
				"--depth=1",
				"--single-branch",
				"--branch",
				targetBranch,
			]);

			return tempDir;
		} catch (error) {
			// Cleanup failed clone
			await fs.rm(tempDir, { recursive: true, force: true });
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to clone repository: ${repoUrl}. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Clones a private GitHub repository using authentication
	 * @param repoUrl The URL of the GitHub repository
	 * @param accessToken GitHub access token for authentication
	 * @param branch Optional branch to clone (defaults to main)
	 * @returns The local path to the cloned repository
	 */
	static async clonePrivateRepository(
		repoUrl: string,
		accessToken: string,
		branch?: string,
	): Promise<string> {
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), `gitagent-${nanoid(6)}-`),
		);
		const git = simpleGit();

		try {
			const repoInfo = this.parseGitHubUrl(repoUrl);
			const targetBranch = branch || repoInfo.branch || "main";

			// Create authenticated URL
			const authenticatedUrl = `https://${accessToken}@github.com/${repoInfo.owner}/${repoInfo.repo}.git`;

			await git.clone(authenticatedUrl, tempDir, [
				"--depth=1",
				"--single-branch",
				"--branch",
				targetBranch,
			]);

			return tempDir;
		} catch (error) {
			// Cleanup failed clone
			await fs.rm(tempDir, { recursive: true, force: true });
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to clone private repository: ${repoUrl}. Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Fetches repository information from GitHub API
	 * @param githubId GitHub provider ID
	 * @param owner Repository owner
	 * @param repo Repository name
	 * @returns Repository information
	 */
	static async getRepositoryInfo(
		githubId: string,
		owner: string,
		repo: string,
	) {
		try {
			const githubProvider = await findGithubById(githubId);
			const octokit = authGithub(githubProvider);

			const { data } = await octokit.rest.repos.get({
				owner,
				repo,
			});

			return {
				id: data.id,
				name: data.name,
				fullName: data.full_name,
				description: data.description,
				isPrivate: data.private,
				defaultBranch: data.default_branch,
				language: data.language,
				stargazersCount: data.stargazers_count,
				forksCount: data.forks_count,
				size: data.size,
				cloneUrl: data.clone_url,
				sshUrl: data.ssh_url,
				createdAt: data.created_at,
				updatedAt: data.updated_at,
				pushedAt: data.pushed_at,
			};
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to fetch repository information: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Validates if a GitHub repository exists and is accessible
	 * @param repoUrl The URL of the GitHub repository
	 * @param accessToken Optional access token for private repositories
	 * @returns boolean indicating if repository is accessible
	 */
	static async validateRepository(
		repoUrl: string,
		accessToken?: string,
	): Promise<boolean> {
		try {
			const repoInfo = this.parseGitHubUrl(repoUrl);

			if (accessToken) {
				// Use authenticated request for private repos
				const response = await fetch(
					`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`,
					{
						headers: {
							Authorization: `token ${accessToken}`,
							Accept: "application/vnd.github.v3+json",
						},
					},
				);
				return response.ok;
			} else {
				// Use unauthenticated request for public repos
				const response = await fetch(
					`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`,
				);
				return response.ok;
			}
		} catch {
			return false;
		}
	}

	/**
	 * Cleanup temporary directory created by repository cloning
	 * @param tempPath Path to the temporary directory
	 */
	static async cleanupTempDirectory(tempPath: string): Promise<void> {
		try {
			await fs.rm(tempPath, { recursive: true, force: true });
		} catch (error) {
			// Log error but don't throw as cleanup failures shouldn't break the main flow
			console.error(
				`Failed to cleanup temporary directory ${tempPath}:`,
				error,
			);
		}
	}
}
