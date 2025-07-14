import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const aiProxyRouter = createTRPCRouter({
	// AI Request Proxy - This is the main endpoint that deployed projects will call
	proxy: publicProcedure
		.input(
			z.object({
				apiKey: z.string().min(1),
				provider: z.enum(["openai", "anthropic", "cohere"]),
				model: z.string().min(1),
				messages: z.array(
					z.object({
						role: z.string(),
						content: z.string(),
					}),
				),
				max_tokens: z.number().optional(),
				temperature: z.number().min(0).max(2).optional(),
				stream: z.boolean().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const { AIProxyService } = await import(
					"@dokploy/server/services/ai-proxy"
				);
				const aiProxy = new AIProxyService();

				return await aiProxy.proxyAIRequest(input.apiKey, input.provider, {
					model: input.model,
					messages: input.messages,
					max_tokens: input.max_tokens,
					temperature: input.temperature,
					stream: input.stream,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `AI proxy request failed: ${error instanceof Error ? error.message : error}`,
					cause: error,
				});
			}
		}),

	// Store user AI credentials (protected endpoint)
	storeCredentials: protectedProcedure
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
	getUsageStats: protectedProcedure
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

	// Get queue status (for monitoring/debugging)
	getQueueStatus: protectedProcedure.query(async () => {
		try {
			const { getBillingQueueStatus, getQuotaQueueStatus } = await import(
				"@/server/queues/billing-queue"
			);

			const [billingStatus, quotaStatus] = await Promise.all([
				getBillingQueueStatus(),
				getQuotaQueueStatus(),
			]);

			return {
				billing: billingStatus,
				quota: quotaStatus,
			};
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Error fetching queue status: ${error instanceof Error ? error.message : error}`,
				cause: error,
			});
		}
	}),

	// Test AI provider connection
	testConnection: protectedProcedure
		.input(
			z.object({
				provider: z.enum(["openai", "anthropic", "cohere"]),
				apiKey: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				// Simple test to validate the API key works
				const testMessages = [
					{ role: "user", content: "Say 'Hello' if you can hear me." },
				];

				const { AIProxyService } = await import(
					"@dokploy/server/services/ai-proxy"
				);
				const aiProxy = new AIProxyService();

				// We'll create a temporary test without storing the credentials
				const testRequest = {
					model:
						input.provider === "openai"
							? "gpt-3.5-turbo"
							: input.provider === "anthropic"
								? "claude-3-haiku-20240307"
								: "command-light",
					messages: testMessages,
					max_tokens: 10,
				};

				// This is a simplified test - in a real implementation, you might want to
				// test the connection without going through the full proxy flow
				const response = await fetch(
					input.provider === "openai"
						? "https://api.openai.com/v1/chat/completions"
						: input.provider === "anthropic"
							? "https://api.anthropic.com/v1/messages"
							: "https://api.cohere.ai/v1/chat",
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(input.provider === "openai" && {
								Authorization: `Bearer ${input.apiKey}`,
							}),
							...(input.provider === "anthropic" && {
								"x-api-key": input.apiKey,
							}),
							...(input.provider === "cohere" && {
								Authorization: `Bearer ${input.apiKey}`,
							}),
						},
						body: JSON.stringify(testRequest),
					},
				);

				return {
					success: response.ok,
					status: response.status,
					message: response.ok ? "Connection successful" : "Connection failed",
				};
			} catch (error) {
				return {
					success: false,
					message: `Connection test failed: ${error instanceof Error ? error.message : error}`,
				};
			}
		}),
});
