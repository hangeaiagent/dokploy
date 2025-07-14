import * as path from "path";
import { db } from "@dokploy/server/db";
import {
	type apiCreateApplication,
	applications,
	userDeployedProjects,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as fs from "fs/promises";
import { nanoid } from "nanoid";
import { createApplication } from "./application";
import { CodeAnalyzerService } from "./code-analyzer";
import { GitHubService } from "./github";

export interface ProjectIngestionInput {
	githubUrl: string;
	projectId: string;
	organizationId: string;
	customName?: string;
	branch?: string;
	accessToken?: string; // For private repositories
}

export interface ProjectIngestionResult {
	application: typeof applications.$inferSelect;
	deployedProject: typeof userDeployedProjects.$inferSelect;
	analysisResult: any;
}

export class ProjectIngestionService {
	private codeAnalyzer: CodeAnalyzerService;

	constructor() {
		this.codeAnalyzer = new CodeAnalyzerService();
	}

	/**
	 * Main ingestion workflow: validates, clones, analyzes, and creates application
	 * @param userId User ID performing the ingestion
	 * @param input Ingestion parameters
	 * @returns Created application and deployment project information
	 */
	async ingestFromGithub(
		userId: string,
		input: ProjectIngestionInput,
	): Promise<ProjectIngestionResult> {
		let repoPath: string | undefined;

		try {
			// Step 1: Validate the GitHub repository
			await this.validateGitHubRepository(input.githubUrl, input.accessToken);

			// Step 2: Generate unique API key for this deployment
			const apiKey = this.generateApiKey();

			// Step 3: Clone the repository
			repoPath = await this.cloneRepository(
				input.githubUrl,
				input.branch,
				input.accessToken,
			);

			// Step 4: Analyze the codebase
			const analysisResult = await this.codeAnalyzer.analyze(repoPath);

			// Step 5: Create Dokploy application
			const application = await this.createDokployApplication(
				userId,
				input,
				analysisResult,
			);

			// Step 6: Save to our tracking table
			const deployedProject = await this.createDeployedProject(
				userId,
				application.applicationId,
				input.githubUrl,
				apiKey,
				analysisResult,
			);

			// Step 7: Prepare source code for deployment
			await this.prepareBuildSource(repoPath, application.applicationId);

			return {
				application,
				deployedProject,
				analysisResult,
			};
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to ingest GitHub project: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			});
		} finally {
			// Step 8: Always cleanup temporary directory
			if (repoPath) {
				await GitHubService.cleanupTempDirectory(repoPath);
			}
		}
	}

	/**
	 * Validates that the GitHub repository exists and is accessible
	 */
	private async validateGitHubRepository(
		githubUrl: string,
		accessToken?: string,
	): Promise<void> {
		const isValid = await GitHubService.validateRepository(
			githubUrl,
			accessToken,
		);
		if (!isValid) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message:
					"GitHub repository not found or not accessible. Please check the URL and permissions.",
			});
		}
	}

	/**
	 * Clones the GitHub repository to a temporary directory
	 */
	private async cloneRepository(
		githubUrl: string,
		branch?: string,
		accessToken?: string,
	): Promise<string> {
		if (accessToken) {
			return await GitHubService.clonePrivateRepository(
				githubUrl,
				accessToken,
				branch,
			);
		} else {
			return await GitHubService.clonePublicRepository(githubUrl, branch);
		}
	}

	/**
	 * Creates a Dokploy application based on the analysis results
	 */
	private async createDokployApplication(
		userId: string,
		input: ProjectIngestionInput,
		analysisResult: any,
	) {
		const repoInfo = GitHubService.parseGitHubUrl(input.githubUrl);
		const appName = input.customName || `${repoInfo.owner}-${repoInfo.repo}`;

		const applicationInput: typeof apiCreateApplication._type = {
			name: appName,
			appName: appName, // This will be processed by buildAppName
			description: `AI-imported project from ${input.githubUrl}`,
			projectId: input.projectId,

			// Build configuration from analysis
			buildType: analysisResult.buildPack,
			sourceType: "github",
			repository: input.githubUrl,
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			branch: input.branch || repoInfo.branch || "main",

			// Runtime configuration
			port: analysisResult.port,
			startCommand: analysisResult.startCommand,
			installCommand: analysisResult.installCommand,
			buildPath: analysisResult.buildPath || "/",

			// Docker configuration if using dockerfile
			...(analysisResult.buildPack === "dockerfile" && {
				dockerFile: "Dockerfile",
			}),

			// Environment variables from analysis
			env: analysisResult.environment
				? Object.entries(analysisResult.environment).map(([name, value]) => ({
						name,
						value: String(value),
					}))
				: [],

			// Health check configuration
			...(analysisResult.healthCheck && {
				healthCheckPath: analysisResult.healthCheck.path,
			}),
		};

		return await createApplication(applicationInput);
	}

	/**
	 * Creates an entry in the user deployed projects table
	 */
	private async createDeployedProject(
		userId: string,
		dokployApplicationId: string,
		githubUrl: string,
		apiKey: string,
		analysisResult: any,
	) {
		const [deployedProject] = await db
			.insert(userDeployedProjects)
			.values({
				userId,
				dokployApplicationId,
				githubUrl,
				apiKey,
				analysisCache: analysisResult,
				deploymentStatus: "created",
			})
			.returning();

		if (!deployedProject) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create deployed project record",
			});
		}

		return deployedProject;
	}

	/**
	 * Prepares the source code for the Dokploy build system
	 * Copies the cloned repository to the permanent build location
	 */
	private async prepareBuildSource(
		repoPath: string,
		applicationId: string,
	): Promise<void> {
		try {
			const buildSourcePath = `/dokploy/builds/sources/${applicationId}`;

			// Ensure the build directory exists
			await fs.mkdir(path.dirname(buildSourcePath), { recursive: true });

			// Copy the source code to the build location
			await fs.cp(repoPath, buildSourcePath, { recursive: true });

			// Set appropriate permissions
			await fs.chmod(buildSourcePath, 0o755);
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to prepare build source: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Generates a unique API key for the deployed project
	 */
	private generateApiKey(): string {
		return `gita_${nanoid(32)}`;
	}

	/**
	 * Retrieves deployed project by API key
	 */
	async getDeployedProjectByApiKey(apiKey: string) {
		const deployedProject = await db.query.userDeployedProjects.findFirst({
			where: eq(userDeployedProjects.apiKey, apiKey),
			with: {
				// Include related application data if needed
			},
		});

		if (!deployedProject) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Deployed project not found for the provided API key",
			});
		}

		return deployedProject;
	}

	/**
	 * Updates deployment status
	 */
	async updateDeploymentStatus(
		deployedProjectId: string,
		status: "created" | "building" | "running" | "failed" | "stopped",
	) {
		const [updatedProject] = await db
			.update(userDeployedProjects)
			.set({
				deploymentStatus: status,
				updatedAt: new Date(),
				...(status === "running" && { lastAccessedAt: new Date() }),
			})
			.where(eq(userDeployedProjects.id, deployedProjectId))
			.returning();

		return updatedProject;
	}

	/**
	 * Lists user's deployed projects
	 */
	async listUserDeployedProjects(userId: string) {
		return await db.query.userDeployedProjects.findMany({
			where: eq(userDeployedProjects.userId, userId),
			orderBy: (projects, { desc }) => [desc(projects.createdAt)],
			with: {
				// Include any needed relations
			},
		});
	}

	/**
	 * Deletes a deployed project and its associated Dokploy application
	 */
	async deleteDeployedProject(deployedProjectId: string, userId: string) {
		return await db.transaction(async (tx) => {
			// Get the deployed project
			const deployedProject = await tx.query.userDeployedProjects.findFirst({
				where: eq(userDeployedProjects.id, deployedProjectId),
			});

			if (!deployedProject) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Deployed project not found",
				});
			}

			if (deployedProject.userId !== userId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Not authorized to delete this project",
				});
			}

			// Delete the Dokploy application
			await tx
				.delete(applications)
				.where(
					eq(applications.applicationId, deployedProject.dokployApplicationId),
				);

			// Delete the deployed project record
			await tx
				.delete(userDeployedProjects)
				.where(eq(userDeployedProjects.id, deployedProjectId));

			// Cleanup build source directory
			try {
				const buildSourcePath = `/dokploy/builds/sources/${deployedProject.dokployApplicationId}`;
				await fs.rm(buildSourcePath, { recursive: true, force: true });
			} catch (error) {
				// Log but don't fail the transaction for cleanup errors
				console.error(
					`Failed to cleanup build source for ${deployedProjectId}:`,
					error,
				);
			}

			return { success: true };
		});
	}
}
