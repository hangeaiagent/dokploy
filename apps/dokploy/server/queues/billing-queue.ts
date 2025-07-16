import { db } from "@dokploy/server/db";
import { apiQuotas, billingRecords } from "@dokploy/server/db/schema";
import { type Job, Queue, Worker } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { redisConfig } from "./redis-connection";

// Billing job types
export interface BillingJobData {
	userId: string;
	deployedProjectId: string;
	serviceType: string;
	usageData: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		compute_hours?: number;
		storage_gb?: number;
		bandwidth_gb?: number;
	};
	metadata?: Record<string, any>;
	timestamp: Date;
}

export interface QuotaUpdateJobData {
	userId: string;
	serviceType: string;
	tokens: number;
}

// Pricing configuration
interface ModelPricing {
	input: number;
	output: number;
}

const PRICING_CONFIG = {
	openai: {
		"gpt-4": { input: 0.03, output: 0.06 } as ModelPricing, // per 1K tokens
		"gpt-4-turbo": { input: 0.01, output: 0.03 } as ModelPricing,
		"gpt-3.5-turbo": { input: 0.0015, output: 0.002 } as ModelPricing,
	},
	anthropic: {
		"claude-3-opus-20240229": { input: 0.015, output: 0.075 } as ModelPricing,
		"claude-3-sonnet-20240229": { input: 0.003, output: 0.015 } as ModelPricing,
		"claude-3-haiku-20240307": {
			input: 0.00025,
			output: 0.00125,
		} as ModelPricing,
	},
	cohere: {
		command: { input: 0.001, output: 0.002 } as ModelPricing,
		"command-light": { input: 0.0003, output: 0.0006 } as ModelPricing,
	},
	compute: {
		cpu_hour: 0.05, // $0.05 per CPU hour
		memory_gb_hour: 0.01, // $0.01 per GB memory hour
	},
	storage: {
		storage_gb_month: 0.1, // $0.10 per GB storage per month
	},
	bandwidth: {
		egress_gb: 0.09, // $0.09 per GB egress
	},
};

// Create billing queue
export const billingQueue = new Queue("billing", {
	connection: redisConfig,
	defaultJobOptions: {
		removeOnComplete: 100, // Keep last 100 completed jobs
		removeOnFail: 50, // Keep last 50 failed jobs
		attempts: 3,
		backoff: {
			type: "exponential",
			delay: 2000,
		},
	},
});

// Create quota update queue
export const quotaQueue = new Queue("quota-updates", {
	connection: redisConfig,
	defaultJobOptions: {
		removeOnComplete: 50,
		removeOnFail: 25,
		attempts: 3,
		backoff: {
			type: "exponential",
			delay: 1000,
		},
	},
});

// Billing worker
export const billingWorker = new Worker(
	"billing",
	async (job: Job<BillingJobData>) => {
		const {
			userId,
			deployedProjectId,
			serviceType,
			usageData,
			metadata,
			timestamp,
		} = job.data;

		try {
			console.log(
				`Processing billing for user ${userId}, service ${serviceType}`,
			);

			if (serviceType.includes("_tokens")) {
				await processTokenUsage(
					userId,
					deployedProjectId,
					serviceType,
					usageData,
					metadata,
				);
			} else if (serviceType.includes("compute")) {
				await processComputeUsage(
					userId,
					deployedProjectId,
					serviceType,
					usageData,
					metadata,
				);
			} else if (serviceType.includes("storage")) {
				await processStorageUsage(
					userId,
					deployedProjectId,
					serviceType,
					usageData,
					metadata,
				);
			} else if (serviceType.includes("bandwidth")) {
				await processBandwidthUsage(
					userId,
					deployedProjectId,
					serviceType,
					usageData,
					metadata,
				);
			}

			console.log(`Billing processed successfully for user ${userId}`);
		} catch (error) {
			console.error(`Billing processing failed for user ${userId}:`, error);
			throw error; // This will trigger retry logic
		}
	},
	{
		autorun: false,
		connection: redisConfig,
		concurrency: 5, // Process up to 5 billing jobs concurrently
	},
);

// Quota update worker
export const quotaWorker = new Worker(
	"quota-updates",
	async (job: Job<QuotaUpdateJobData>) => {
		const { userId, serviceType, tokens } = job.data;

		try {
			console.log(
				`Updating quota for user ${userId}, service ${serviceType}, tokens ${tokens}`,
			);

			const today = new Date();
			today.setHours(0, 0, 0, 0);

			// Update quota usage with proper daily/monthly reset logic
			await db
				.update(apiQuotas)
				.set({
					currentDailyUsage: sql`CASE 
						WHEN DATE(updated_at) < DATE(${today}) 
						THEN ${tokens} 
						ELSE current_daily_usage + ${tokens} 
					END`,
					currentMonthlyUsage: sql`CASE 
						WHEN DATE_TRUNC('month', updated_at) < DATE_TRUNC('month', ${today}) 
						THEN ${tokens} 
						ELSE current_monthly_usage + ${tokens} 
					END`,
				})
				.where(
					and(
						eq(apiQuotas.userId, userId),
						eq(apiQuotas.serviceType, serviceType),
					),
				);

			console.log(`Quota updated successfully for user ${userId}`);
		} catch (error) {
			console.error(`Quota update failed for user ${userId}:`, error);
			throw error;
		}
	},
	{
		autorun: false,
		connection: redisConfig,
		concurrency: 10, // Higher concurrency for quota updates
	},
);

// Helper functions for processing different usage types
async function processTokenUsage(
	userId: string,
	deployedProjectId: string,
	serviceType: string,
	usageData: BillingJobData["usageData"],
	metadata?: Record<string, any>,
) {
	const provider = serviceType.split("_")[0]; // e.g., 'openai' from 'openai_tokens'
	const model = metadata?.model;

	if (!model || !provider || !(provider in PRICING_CONFIG)) {
		console.warn(
			`No pricing config found for ${provider}/${model}, using default rates`,
		);
		return;
	}

	const providerConfig =
		PRICING_CONFIG[provider as keyof typeof PRICING_CONFIG];
	if (typeof providerConfig !== "object" || !(model in providerConfig)) {
		console.warn(`Model ${model} not found in pricing config for ${provider}`);
		return;
	}

	const pricing = providerConfig[
		model as keyof typeof providerConfig
	] as ModelPricing;
	const { prompt_tokens = 0, completion_tokens = 0 } = usageData;

	// Calculate costs (pricing is per 1K tokens)
	const inputCost = (prompt_tokens / 1000) * pricing.input;
	const outputCost = (completion_tokens / 1000) * pricing.output;

	// Insert separate billing records for input and output tokens
	await db.insert(billingRecords).values([
		{
			userId,
			deployedProjectId,
			serviceType: `${provider}_input_tokens`,
			quantity: prompt_tokens.toString(),
			unitPrice: (pricing.input / 1000).toString(),
			totalCost: inputCost.toFixed(8),
			currency: "USD",
			metadata: { model, provider, ...metadata },
		},
		{
			userId,
			deployedProjectId,
			serviceType: `${provider}_output_tokens`,
			quantity: completion_tokens.toString(),
			unitPrice: (pricing.output / 1000).toString(),
			totalCost: outputCost.toFixed(8),
			currency: "USD",
			metadata: { model, provider, ...metadata },
		},
	]);
}

async function processComputeUsage(
	userId: string,
	deployedProjectId: string,
	serviceType: string,
	usageData: BillingJobData["usageData"],
	metadata?: Record<string, any>,
) {
	const { compute_hours = 0 } = usageData;
	const unitPrice = PRICING_CONFIG.compute.cpu_hour;
	const totalCost = compute_hours * unitPrice;

	await db.insert(billingRecords).values({
		userId,
		deployedProjectId,
		serviceType,
		quantity: compute_hours.toString(),
		unitPrice: unitPrice.toString(),
		totalCost: totalCost.toFixed(8),
		currency: "USD",
		metadata,
	});
}

async function processStorageUsage(
	userId: string,
	deployedProjectId: string,
	serviceType: string,
	usageData: BillingJobData["usageData"],
	metadata?: Record<string, any>,
) {
	const { storage_gb = 0 } = usageData;
	const unitPrice = PRICING_CONFIG.storage.storage_gb_month;
	const totalCost = storage_gb * unitPrice;

	await db.insert(billingRecords).values({
		userId,
		deployedProjectId,
		serviceType,
		quantity: storage_gb.toString(),
		unitPrice: unitPrice.toString(),
		totalCost: totalCost.toFixed(8),
		currency: "USD",
		metadata,
	});
}

async function processBandwidthUsage(
	userId: string,
	deployedProjectId: string,
	serviceType: string,
	usageData: BillingJobData["usageData"],
	metadata?: Record<string, any>,
) {
	const { bandwidth_gb = 0 } = usageData;
	const unitPrice = PRICING_CONFIG.bandwidth.egress_gb;
	const totalCost = bandwidth_gb * unitPrice;

	await db.insert(billingRecords).values({
		userId,
		deployedProjectId,
		serviceType,
		quantity: bandwidth_gb.toString(),
		unitPrice: unitPrice.toString(),
		totalCost: totalCost.toFixed(8),
		currency: "USD",
		metadata,
	});
}

// Utility functions to add jobs to queues
export const addBillingJob = async (data: BillingJobData) => {
	return await billingQueue.add("process-billing", data, {
		priority: 1, // Normal priority
		delay: 0, // Process immediately
	});
};

export const addQuotaUpdateJob = async (data: QuotaUpdateJobData) => {
	return await quotaQueue.add("update-quota", data, {
		priority: 10, // High priority for quota updates
		delay: 0,
	});
};

// Bulk billing job for processing multiple usage records at once
export const addBulkBillingJob = async (records: BillingJobData[]) => {
	const jobs = records.map((record, index) => ({
		name: "process-billing",
		data: record,
		opts: {
			priority: 1,
			delay: index * 100, // Stagger jobs slightly to avoid overwhelming the system
		},
	}));

	return await billingQueue.addBulk(jobs);
};

// Queue status monitoring functions
export const getBillingQueueStatus = async () => {
	const [waiting, active, completed, failed] = await Promise.all([
		billingQueue.getWaiting(),
		billingQueue.getActive(),
		billingQueue.getCompleted(),
		billingQueue.getFailed(),
	]);

	return {
		waiting: waiting.length,
		active: active.length,
		completed: completed.length,
		failed: failed.length,
	};
};

export const getQuotaQueueStatus = async () => {
	const [waiting, active, completed, failed] = await Promise.all([
		quotaQueue.getWaiting(),
		quotaQueue.getActive(),
		quotaQueue.getCompleted(),
		quotaQueue.getFailed(),
	]);

	return {
		waiting: waiting.length,
		active: active.length,
		completed: completed.length,
		failed: failed.length,
	};
};
