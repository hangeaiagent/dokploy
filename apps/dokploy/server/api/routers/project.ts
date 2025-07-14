import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { db } from "@/server/db";
import {
	apiCreateProject,
	apiFindOneProject,
	apiRemoveProject,
	apiUpdateProject,
	applications,
	compose,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "@/server/db/schema";
import { z } from "zod";

import {
	IS_CLOUD,
	addNewProject,
	checkProjectAccess,
	createApplication,
	createBackup,
	createCompose,
	createDomain,
	createMariadb,
	createMongo,
	createMount,
	createMysql,
	createPort,
	createPostgres,
	createPreviewDeployment,
	createProject,
	createRedirect,
	createRedis,
	createSecurity,
	deleteProject,
	findApplicationById,
	findComposeById,
	findMariadbById,
	findMemberById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findProjectById,
	findRedisById,
	findUserById,
	updateProjectById,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const projectRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateProject)
		.mutation(async ({ ctx, input }) => {
			try {
				if (ctx.user.role === "member") {
					await checkProjectAccess(
						ctx.user.id,
						"create",
						ctx.session.activeOrganizationId,
					);
				}

				const admin = await findUserById(ctx.user.ownerId);

				if (admin.serversQuantity === 0 && IS_CLOUD) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "No servers available, Please subscribe to a plan",
					});
				}

				const project = await createProject(
					input,
					ctx.session.activeOrganizationId,
				);
				if (ctx.user.role === "member") {
					await addNewProject(
						ctx.user.id,
						project.projectId,
						ctx.session.activeOrganizationId,
					);
				}

				return project;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error creating the project: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	one: protectedProcedure
		.input(apiFindOneProject)
		.query(async ({ input, ctx }) => {
			if (ctx.user.role === "member") {
				const { accessedServices } = await findMemberById(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);

				await checkProjectAccess(
					ctx.user.id,
					"access",
					ctx.session.activeOrganizationId,
					input.projectId,
				);

				const project = await db.query.projects.findFirst({
					where: and(
						eq(projects.projectId, input.projectId),
						eq(projects.organizationId, ctx.session.activeOrganizationId),
					),
					with: {
						applications: {
							where: buildServiceFilter(
								applications.applicationId,
								accessedServices,
							),
						},
						compose: {
							where: buildServiceFilter(compose.composeId, accessedServices),
						},
						mariadb: {
							where: buildServiceFilter(mariadb.mariadbId, accessedServices),
						},
						mongo: {
							where: buildServiceFilter(mongo.mongoId, accessedServices),
						},
						mysql: {
							where: buildServiceFilter(mysql.mysqlId, accessedServices),
						},
						postgres: {
							where: buildServiceFilter(postgres.postgresId, accessedServices),
						},
						redis: {
							where: buildServiceFilter(redis.redisId, accessedServices),
						},
					},
				});

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Project not found",
					});
				}
				return project;
			}
			const project = await findProjectById(input.projectId);

			if (project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this project",
				});
			}
			return project;
		}),
	all: protectedProcedure.query(async ({ ctx }) => {
		if (ctx.user.role === "member") {
			const { accessedProjects, accessedServices } = await findMemberById(
				ctx.user.id,
				ctx.session.activeOrganizationId,
			);

			if (accessedProjects.length === 0) {
				return [];
			}

			return await db.query.projects.findMany({
				where: and(
					sql`${projects.projectId} IN (${sql.join(
						accessedProjects.map((projectId) => sql`${projectId}`),
						sql`, `,
					)})`,
					eq(projects.organizationId, ctx.session.activeOrganizationId),
				),
				with: {
					applications: {
						where: buildServiceFilter(
							applications.applicationId,
							accessedServices,
						),
						with: { domains: true },
					},
					mariadb: {
						where: buildServiceFilter(mariadb.mariadbId, accessedServices),
					},
					mongo: {
						where: buildServiceFilter(mongo.mongoId, accessedServices),
					},
					mysql: {
						where: buildServiceFilter(mysql.mysqlId, accessedServices),
					},
					postgres: {
						where: buildServiceFilter(postgres.postgresId, accessedServices),
					},
					redis: {
						where: buildServiceFilter(redis.redisId, accessedServices),
					},
					compose: {
						where: buildServiceFilter(compose.composeId, accessedServices),
						with: { domains: true },
					},
				},
				orderBy: desc(projects.createdAt),
			});
		}

		return await db.query.projects.findMany({
			with: {
				applications: {
					with: {
						domains: true,
					},
				},
				mariadb: true,
				mongo: true,
				mysql: true,
				postgres: true,
				redis: true,
				compose: {
					with: {
						domains: true,
					},
				},
			},
			where: eq(projects.organizationId, ctx.session.activeOrganizationId),
			orderBy: desc(projects.createdAt),
		});
	}),

	remove: protectedProcedure
		.input(apiRemoveProject)
		.mutation(async ({ input, ctx }) => {
			try {
				if (ctx.user.role === "member") {
					await checkProjectAccess(
						ctx.user.id,
						"delete",
						ctx.session.activeOrganizationId,
					);
				}
				const currentProject = await findProjectById(input.projectId);
				if (
					currentProject.organizationId !== ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to delete this project",
					});
				}
				const deletedProject = await deleteProject(input.projectId);

				return deletedProject;
			} catch (error) {
				throw error;
			}
		}),
	update: protectedProcedure
		.input(apiUpdateProject)
		.mutation(async ({ input, ctx }) => {
			try {
				const currentProject = await findProjectById(input.projectId);
				if (
					currentProject.organizationId !== ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to update this project",
					});
				}
				const project = await updateProjectById(input.projectId, {
					...input,
				});

				return project;
			} catch (error) {
				throw error;
			}
		}),
	duplicate: protectedProcedure
		.input(
			z.object({
				sourceProjectId: z.string(),
				name: z.string(),
				description: z.string().optional(),
				includeServices: z.boolean().default(true),
				selectedServices: z
					.array(
						z.object({
							id: z.string(),
							type: z.enum([
								"application",
								"postgres",
								"mariadb",
								"mongo",
								"mysql",
								"redis",
								"compose",
							]),
						}),
					)
					.optional(),
				duplicateInSameProject: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				if (ctx.user.role === "member") {
					await checkProjectAccess(
						ctx.user.id,
						"create",
						ctx.session.activeOrganizationId,
					);
				}

				// Get source project
				const sourceProject = await findProjectById(input.sourceProjectId);

				if (sourceProject.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this project",
					});
				}

				// Create new project or use existing one
				const targetProject = input.duplicateInSameProject
					? sourceProject
					: await createProject(
							{
								name: input.name,
								description: input.description,
								env: sourceProject.env,
							},
							ctx.session.activeOrganizationId,
						);

				if (input.includeServices) {
					const servicesToDuplicate = input.selectedServices || [];

					// Helper function to duplicate a service
					const duplicateService = async (id: string, type: string) => {
						switch (type) {
							case "application": {
								const {
									applicationId,
									domains,
									security,
									ports,
									registry,
									redirects,
									previewDeployments,
									mounts,
									appName,
									...application
								} = await findApplicationById(id);
								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newApplication = await createApplication({
									...application,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${application.name} (copy)`
										: application.name,
									projectId: targetProject.projectId,
								});

								for (const domain of domains) {
									const { domainId, ...rest } = domain;
									await createDomain({
										...rest,
										applicationId: newApplication.applicationId,
										domainType: "application",
									});
								}

								for (const port of ports) {
									const { portId, ...rest } = port;
									await createPort({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newApplication.applicationId,
										serviceType: "application",
									});
								}

								for (const redirect of redirects) {
									const { redirectId, ...rest } = redirect;
									await createRedirect({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const secure of security) {
									const { securityId, ...rest } = secure;
									await createSecurity({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const previewDeployment of previewDeployments) {
									const { previewDeploymentId, ...rest } = previewDeployment;
									await createPreviewDeployment({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								break;
							}
							case "postgres": {
								const { postgresId, mounts, backups, appName, ...postgres } =
									await findPostgresById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newPostgres = await createPostgres({
									...postgres,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${postgres.name} (copy)`
										: postgres.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newPostgres.postgresId,
										serviceType: "postgres",
									});
								}

								for (const backup of backups) {
									const { backupId, ...rest } = backup;
									await createBackup({
										...rest,
										postgresId: newPostgres.postgresId,
									});
								}
								break;
							}
							case "mariadb": {
								const { mariadbId, mounts, backups, appName, ...mariadb } =
									await findMariadbById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMariadb = await createMariadb({
									...mariadb,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mariadb.name} (copy)`
										: mariadb.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMariadb.mariadbId,
										serviceType: "mariadb",
									});
								}

								for (const backup of backups) {
									const { backupId, ...rest } = backup;
									await createBackup({
										...rest,
										mariadbId: newMariadb.mariadbId,
									});
								}
								break;
							}
							case "mongo": {
								const { mongoId, mounts, backups, appName, ...mongo } =
									await findMongoById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMongo = await createMongo({
									...mongo,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mongo.name} (copy)`
										: mongo.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMongo.mongoId,
										serviceType: "mongo",
									});
								}

								for (const backup of backups) {
									const { backupId, ...rest } = backup;
									await createBackup({
										...rest,
										mongoId: newMongo.mongoId,
									});
								}
								break;
							}
							case "mysql": {
								const { mysqlId, mounts, backups, appName, ...mysql } =
									await findMySqlById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMysql = await createMysql({
									...mysql,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mysql.name} (copy)`
										: mysql.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMysql.mysqlId,
										serviceType: "mysql",
									});
								}

								for (const backup of backups) {
									const { backupId, ...rest } = backup;
									await createBackup({
										...rest,
										mysqlId: newMysql.mysqlId,
									});
								}
								break;
							}
							case "redis": {
								const { redisId, mounts, appName, ...redis } =
									await findRedisById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newRedis = await createRedis({
									...redis,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${redis.name} (copy)`
										: redis.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newRedis.redisId,
										serviceType: "redis",
									});
								}

								break;
							}
							case "compose": {
								const { composeId, mounts, domains, appName, ...compose } =
									await findComposeById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newCompose = await createCompose({
									...compose,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${compose.name} (copy)`
										: compose.name,
									projectId: targetProject.projectId,
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newCompose.composeId,
										serviceType: "compose",
									});
								}

								for (const domain of domains) {
									const { domainId, ...rest } = domain;
									await createDomain({
										...rest,
										composeId: newCompose.composeId,
										domainType: "compose",
									});
								}

								break;
							}
						}
					};

					// Duplicate selected services
					for (const service of servicesToDuplicate) {
						await duplicateService(service.id, service.type);
					}
				}

				if (!input.duplicateInSameProject && ctx.user.role === "member") {
					await addNewProject(
						ctx.user.id,
						targetProject.projectId,
						ctx.session.activeOrganizationId,
					);
				}

				return targetProject;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error duplicating the project: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// GitHub Project Ingestion Endpoints
	ingestFromGithub: protectedProcedure
		.input(
			z.object({
				githubUrl: z.string().url(),
				projectId: z.string().min(1),
				customName: z.string().optional(),
				branch: z.string().optional(),
				accessToken: z.string().optional(), // For private repositories
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				// Import ProjectIngestionService
				const { ProjectIngestionService } = await import(
					"@dokploy/server/services/project-ingestion"
				);
				const ingestionService = new ProjectIngestionService();

				return await ingestionService.ingestFromGithub(ctx.user.id, {
					githubUrl: input.githubUrl,
					projectId: input.projectId,
					organizationId: ctx.session.activeOrganizationId,
					customName: input.customName,
					branch: input.branch,
					accessToken: input.accessToken,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error ingesting GitHub project: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// List user's deployed projects
	listDeployedProjects: protectedProcedure.query(async ({ ctx }) => {
		try {
			const { ProjectIngestionService } = await import(
				"@dokploy/server/services/project-ingestion"
			);
			const ingestionService = new ProjectIngestionService();

			return await ingestionService.listUserDeployedProjects(ctx.user.id);
		} catch (error) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Error fetching deployed projects: ${error instanceof Error ? error.message : error}`,
				cause: error,
			});
		}
	}),

	// Deploy an imported project
	deployImportedProject: protectedProcedure
		.input(
			z.object({
				deployedProjectId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const { deployImportedProject } = await import(
					"@dokploy/server/services/deployment"
				);

				return await deployImportedProject(
					input.deployedProjectId,
					ctx.user.id,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error deploying imported project: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Get deployment history for an imported project
	getImportedProjectDeployments: protectedProcedure
		.input(
			z.object({
				deployedProjectId: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			try {
				const { getImportedProjectDeployments } = await import(
					"@dokploy/server/services/deployment"
				);

				return await getImportedProjectDeployments(
					input.deployedProjectId,
					ctx.user.id,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error fetching deployment history: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Delete an imported project
	deleteImportedProject: protectedProcedure
		.input(
			z.object({
				deployedProjectId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const { ProjectIngestionService } = await import(
					"@dokploy/server/services/project-ingestion"
				);
				const ingestionService = new ProjectIngestionService();

				return await ingestionService.deleteDeployedProject(
					input.deployedProjectId,
					ctx.user.id,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error deleting imported project: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Validate GitHub repository
	validateGithubRepository: protectedProcedure
		.input(
			z.object({
				githubUrl: z.string().url(),
				accessToken: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				const { GitHubService } = await import(
					"@dokploy/server/services/github"
				);

				const isValid = await GitHubService.validateRepository(
					input.githubUrl,
					input.accessToken,
				);

				return { isValid };
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error validating GitHub repository: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Store user AI credentials
	storeAiCredentials: protectedProcedure
		.input(
			z.object({
				provider: z.enum(["openai", "anthropic", "cohere"]),
				apiKey: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const { AIProxyService } = await import(
					"@dokploy/server/services/ai-proxy"
				);
				const aiProxy = new AIProxyService();

				await aiProxy.storeUserAICredentials(
					ctx.user.id,
					input.provider,
					input.apiKey,
				);

				// Initialize quotas for new users
				await aiProxy.initializeUserQuotas(ctx.user.id);

				return { success: true };
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error storing AI credentials: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Get user usage statistics
	getUserUsageStats: protectedProcedure
		.input(
			z.object({
				timeframe: z.enum(["daily", "monthly", "all"]).default("monthly"),
			}),
		)
		.query(async ({ ctx, input }) => {
			try {
				const { AIProxyService } = await import(
					"@dokploy/server/services/ai-proxy"
				);
				const aiProxy = new AIProxyService();

				return await aiProxy.getUserUsageStats(ctx.user.id, input.timeframe);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Error fetching usage stats: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),
});

function buildServiceFilter(
	fieldName: AnyPgColumn,
	accessedServices: string[],
) {
	return accessedServices.length === 0
		? sql`false`
		: sql`${fieldName} IN (${sql.join(
				accessedServices.map((serviceId) => sql`${serviceId}`),
				sql`, `,
			)})`;
}
