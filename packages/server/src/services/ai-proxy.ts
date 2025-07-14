import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scryptSync,
} from "crypto";
import { db } from "@dokploy/server/db";
import {
	apiQuotas,
	billingRecords,
	userAiCredentials,
	userDeployedProjects,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, sql, sum } from "drizzle-orm";
import { nanoid } from "nanoid";

// AI Provider configurations
interface AIProviderConfig {
	name: string;
	baseUrl: string;
	apiKeyHeader: string;
	models: Record<string, AIModelPricing>;
}

interface AIModelPricing {
	inputTokenPrice: number; // Price per 1K input tokens
	outputTokenPrice: number; // Price per 1K output tokens
}

interface AIRequestPayload {
	model: string;
	messages: Array<{
		role: string;
		content: string;
	}>;
	max_tokens?: number;
	temperature?: number;
	stream?: boolean;
}

interface AIResponseUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

interface AIResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: string;
			content: string;
		};
		finish_reason: string;
	}>;
	usage: AIResponseUsage;
}

// Supported AI providers with their configurations
const AI_PROVIDERS: Record<string, AIProviderConfig> = {
	openai: {
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		apiKeyHeader: "Authorization",
		models: {
			"gpt-4": { inputTokenPrice: 0.03, outputTokenPrice: 0.06 },
			"gpt-4-turbo": { inputTokenPrice: 0.01, outputTokenPrice: 0.03 },
			"gpt-3.5-turbo": { inputTokenPrice: 0.0015, outputTokenPrice: 0.002 },
		},
	},
	anthropic: {
		name: "Anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		apiKeyHeader: "x-api-key",
		models: {
			"claude-3-opus-20240229": {
				inputTokenPrice: 0.015,
				outputTokenPrice: 0.075,
			},
			"claude-3-sonnet-20240229": {
				inputTokenPrice: 0.003,
				outputTokenPrice: 0.015,
			},
			"claude-3-haiku-20240307": {
				inputTokenPrice: 0.00025,
				outputTokenPrice: 0.00125,
			},
		},
	},
	cohere: {
		name: "Cohere",
		baseUrl: "https://api.cohere.ai/v1",
		apiKeyHeader: "Authorization",
		models: {
			command: { inputTokenPrice: 0.001, outputTokenPrice: 0.002 },
			"command-light": { inputTokenPrice: 0.0003, outputTokenPrice: 0.0006 },
		},
	},
};

export class AIProxyService {
	private readonly encryptionKey: string;
	private readonly ivLength = 16;

	constructor() {
		this.encryptionKey =
			process.env.CREDENTIAL_ENCRYPTION_KEY || this.generateDefaultKey();
		if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
			console.warn(
				"CREDENTIAL_ENCRYPTION_KEY not set, using generated key. This is not secure for production!",
			);
		}
	}

	/**
	 * Main proxy endpoint for AI requests
	 */
	async proxyAIRequest(
		apiKey: string,
		provider: string,
		requestPayload: AIRequestPayload,
	): Promise<AIResponse> {
		try {
			// Step 1: Validate API key and get user context
			const deployedProject = await this.validateApiKey(apiKey);

			// Step 2: Check rate limits and quotas
			await this.checkQuotas(deployedProject.userId, provider);

			// Step 3: Get and decrypt user's AI credentials
			const aiCredentials = await this.getUserAICredentials(
				deployedProject.userId,
				provider,
			);

			// Step 4: Validate the requested model
			const providerConfig = this.getProviderConfig(provider);
			const modelPricing = this.validateModel(provider, requestPayload.model);

			// Step 5: Make the actual AI API request
			const response = await this.makeAIRequest(
				providerConfig,
				aiCredentials.decryptedApiKey,
				requestPayload,
			);

			// Step 6: Log usage and billing asynchronously
			this.logUsageAsync(
				deployedProject.userId,
				deployedProject.id,
				provider,
				requestPayload.model,
				response.usage,
				modelPricing,
			);

			// Step 7: Update quota usage
			await this.updateQuotaUsage(
				deployedProject.userId,
				provider,
				response.usage.total_tokens,
			);

			return response;
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `AI proxy request failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Store encrypted AI credentials for a user
	 */
	async storeUserAICredentials(
		userId: string,
		provider: string,
		apiKey: string,
	): Promise<void> {
		try {
			// Validate provider
			if (!AI_PROVIDERS[provider]) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Unsupported AI provider: ${provider}`,
				});
			}

			// Encrypt the API key
			const encryptedApiKey = this.encrypt(apiKey);
			const keyHash = this.hashApiKey(apiKey);

			// Check if credentials already exist for this user and provider
			const existingCreds = await db.query.userAiCredentials.findFirst({
				where: and(
					eq(userAiCredentials.userId, userId),
					eq(userAiCredentials.provider, provider),
				),
			});

			if (existingCreds) {
				// Update existing credentials
				await db
					.update(userAiCredentials)
					.set({
						encryptedApiKey,
						keyHash,
						isActive: true,
						lastUsedAt: new Date(),
					})
					.where(eq(userAiCredentials.id, existingCreds.id));
			} else {
				// Create new credentials
				await db.insert(userAiCredentials).values({
					userId,
					provider,
					encryptedApiKey,
					keyHash,
					isActive: true,
				});
			}
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to store AI credentials: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	}

	/**
	 * Initialize default quotas for a user
	 */
	async initializeUserQuotas(userId: string): Promise<void> {
		const defaultQuotas = [
			{
				serviceType: "openai_tokens",
				dailyLimit: "10000", // 10K tokens per day
				monthlyLimit: "100000", // 100K tokens per month
			},
			{
				serviceType: "anthropic_tokens",
				dailyLimit: "10000",
				monthlyLimit: "100000",
			},
			{
				serviceType: "cohere_tokens",
				dailyLimit: "10000",
				monthlyLimit: "100000",
			},
		];

		for (const quota of defaultQuotas) {
			const resetDate = new Date();
			resetDate.setMonth(resetDate.getMonth() + 1, 1); // Next month's first day

			await db
				.insert(apiQuotas)
				.values({
					userId,
					serviceType: quota.serviceType,
					dailyLimit: quota.dailyLimit,
					monthlyLimit: quota.monthlyLimit,
					resetDate,
				})
				.onConflictDoNothing();
		}
	}

	/**
	 * Get user's usage statistics
	 */
	async getUserUsageStats(
		userId: string,
		timeframe: "daily" | "monthly" | "all",
	) {
		const now = new Date();
		let startDate: Date;

		switch (timeframe) {
			case "daily":
				startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
				break;
			case "monthly":
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				break;
			case "all":
				startDate = new Date(0); // Beginning of time
				break;
		}

		const usage = await db
			.select({
				serviceType: billingRecords.serviceType,
				totalQuantity: sum(billingRecords.quantity),
				totalCost: sum(billingRecords.totalCost),
			})
			.from(billingRecords)
			.where(
				and(
					eq(billingRecords.userId, userId),
					gte(billingRecords.recordedAt, startDate),
					lte(billingRecords.recordedAt, now),
				),
			)
			.groupBy(billingRecords.serviceType);

		return usage;
	}

	// Private methods

	private async validateApiKey(apiKey: string) {
		const deployedProject = await db.query.userDeployedProjects.findFirst({
			where: eq(userDeployedProjects.apiKey, apiKey),
		});

		if (!deployedProject) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "Invalid API key",
			});
		}

		return deployedProject;
	}

	private async checkQuotas(userId: string, provider: string): Promise<void> {
		const serviceType = `${provider}_tokens`;
		const now = new Date();

		const quota = await db.query.apiQuotas.findFirst({
			where: and(
				eq(apiQuotas.userId, userId),
				eq(apiQuotas.serviceType, serviceType),
				eq(apiQuotas.isActive, true),
			),
		});

		if (quota) {
			const dailyUsage = Number(quota.currentDailyUsage);
			const monthlyUsage = Number(quota.currentMonthlyUsage);
			const dailyLimit = Number(quota.dailyLimit);
			const monthlyLimit = Number(quota.monthlyLimit);

			if (dailyLimit && dailyUsage >= dailyLimit) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Daily quota exceeded",
				});
			}

			if (monthlyLimit && monthlyUsage >= monthlyLimit) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Monthly quota exceeded",
				});
			}
		}
	}

	private async getUserAICredentials(userId: string, provider: string) {
		const credentials = await db.query.userAiCredentials.findFirst({
			where: and(
				eq(userAiCredentials.userId, userId),
				eq(userAiCredentials.provider, provider),
				eq(userAiCredentials.isActive, true),
			),
		});

		if (!credentials) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: `No active AI credentials found for provider: ${provider}`,
			});
		}

		const decryptedApiKey = this.decrypt(credentials.encryptedApiKey);

		return {
			...credentials,
			decryptedApiKey,
		};
	}

	private getProviderConfig(provider: string): AIProviderConfig {
		const config = AI_PROVIDERS[provider];
		if (!config) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Unsupported AI provider: ${provider}`,
			});
		}
		return config;
	}

	private validateModel(provider: string, model: string): AIModelPricing {
		const providerConfig = this.getProviderConfig(provider);
		const modelPricing = providerConfig.models[model];

		if (!modelPricing) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Unsupported model '${model}' for provider '${provider}'`,
			});
		}

		return modelPricing;
	}

	private async makeAIRequest(
		config: AIProviderConfig,
		apiKey: string,
		payload: AIRequestPayload,
	): Promise<AIResponse> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};

		// Set the appropriate authentication header
		if (config.apiKeyHeader === "Authorization") {
			headers.Authorization = `Bearer ${apiKey}`;
		} else {
			headers[config.apiKeyHeader] = apiKey;
		}

		// Handle different provider request formats
		let requestBody: any = payload;
		let endpoint = "/chat/completions";

		if (config.name === "Anthropic") {
			// Anthropic uses a different format
			endpoint = "/messages";
			requestBody = {
				model: payload.model,
				max_tokens: payload.max_tokens || 1000,
				messages: payload.messages,
			};
		}

		const response = await fetch(`${config.baseUrl}${endpoint}`, {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `AI API request failed: ${response.status} ${errorText}`,
			});
		}

		const responseData = await response.json();

		// Normalize response format for different providers
		if (config.name === "Anthropic") {
			return this.normalizeAnthropicResponse(responseData);
		}

		return responseData;
	}

	private normalizeAnthropicResponse(anthropicResponse: any): AIResponse {
		return {
			id: anthropicResponse.id,
			object: "chat.completion",
			created: Date.now(),
			model: anthropicResponse.model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: anthropicResponse.content[0]?.text || "",
					},
					finish_reason: anthropicResponse.stop_reason,
				},
			],
			usage: {
				prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
				completion_tokens: anthropicResponse.usage?.output_tokens || 0,
				total_tokens:
					(anthropicResponse.usage?.input_tokens || 0) +
					(anthropicResponse.usage?.output_tokens || 0),
			},
		};
	}

	private async logUsageAsync(
		userId: string,
		deployedProjectId: string,
		provider: string,
		model: string,
		usage: AIResponseUsage,
		pricing: AIModelPricing,
	): Promise<void> {
		// This should ideally be sent to a queue for async processing
		try {
			const inputCost = (usage.prompt_tokens / 1000) * pricing.inputTokenPrice;
			const outputCost =
				(usage.completion_tokens / 1000) * pricing.outputTokenPrice;

			await db.insert(billingRecords).values([
				{
					userId,
					deployedProjectId,
					serviceType: `${provider}_input_tokens`,
					quantity: usage.prompt_tokens.toString(),
					unitPrice: (pricing.inputTokenPrice / 1000).toString(),
					totalCost: inputCost.toString(),
					metadata: { model, provider },
				},
				{
					userId,
					deployedProjectId,
					serviceType: `${provider}_output_tokens`,
					quantity: usage.completion_tokens.toString(),
					unitPrice: (pricing.outputTokenPrice / 1000).toString(),
					totalCost: outputCost.toString(),
					metadata: { model, provider },
				},
			]);
		} catch (error) {
			console.error("Failed to log usage:", error);
		}
	}

	private async updateQuotaUsage(
		userId: string,
		provider: string,
		tokens: number,
	): Promise<void> {
		const serviceType = `${provider}_tokens`;
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		await db
			.update(apiQuotas)
			.set({
				currentDailyUsage: sql`CASE 
					WHEN DATE(${apiQuotas.resetDate}) <= DATE(${today}) 
					THEN ${tokens} 
					ELSE ${apiQuotas.currentDailyUsage} + ${tokens} 
				END`,
				currentMonthlyUsage: sql`${apiQuotas.currentMonthlyUsage} + ${tokens}`,
			})
			.where(
				and(
					eq(apiQuotas.userId, userId),
					eq(apiQuotas.serviceType, serviceType),
				),
			);
	}

	// Encryption/Decryption methods
	private encrypt(text: string): string {
		const iv = randomBytes(this.ivLength);
		const key = scryptSync(this.encryptionKey, "salt", 32);
		const cipher = createCipheriv("aes-256-cbc", key, iv);

		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");

		return iv.toString("hex") + ":" + encrypted;
	}

	private decrypt(encryptedText: string): string {
		const [ivHex, encrypted] = encryptedText.split(":");
		if (!ivHex || !encrypted) {
			throw new Error("Invalid encrypted text format");
		}
		const iv = Buffer.from(ivHex, "hex");
		const key = scryptSync(this.encryptionKey, "salt", 32);
		const decipher = createDecipheriv("aes-256-cbc", key, iv);

		let decrypted = decipher.update(encrypted, "hex", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	}

	private hashApiKey(apiKey: string): string {
		return createHash("sha256").update(apiKey).digest("hex");
	}

	private generateDefaultKey(): string {
		return nanoid(32);
	}
}
