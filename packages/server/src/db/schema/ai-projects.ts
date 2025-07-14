import {
	boolean,
	decimal,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { applications } from "./application";
import { users_temp } from "./user";

// AI项目市场展示表
export const aiMarketplaceProjects = pgTable(
	"ai_marketplace_projects",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		name: varchar("name", { length: 255 }).notNull(),
		description: text("description"),
		githubUrl: varchar("github_url", { length: 255 }).notNull().unique(),
		stars: integer("stars").default(0),
		forks: integer("forks").default(0),
		language: varchar("language", { length: 50 }),
		framework: varchar("framework", { length: 100 }),
		category: varchar("category", { length: 100 }),
		tags: text("tags").array(),
		logoUrl: varchar("logo_url", { length: 255 }),
		isFeatured: boolean("is_featured").default(false),
		isActive: boolean("is_active").default(true),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		categoryIdx: index("idx_marketplace_category").on(table.category),
		languageIdx: index("idx_marketplace_language").on(table.language),
		starsIdx: index("idx_marketplace_stars").on(table.stars),
		activeIdx: index("idx_marketplace_active").on(table.isActive),
	}),
);

// 用户部署项目表
export const userDeployedProjects = pgTable(
	"user_deployed_projects",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("user_id")
			.references(() => users_temp.id)
			.notNull(),
		dokployApplicationId: text("dokploy_application_id")
			.references(() => applications.applicationId)
			.notNull()
			.unique(),
		githubUrl: varchar("github_url", { length: 255 }).notNull(),
		apiKey: varchar("api_key", { length: 64 }).notNull().unique(),
		analysisCache: jsonb("analysis_cache"),
		deploymentStatus: varchar("deployment_status", { length: 50 }).default(
			"created",
		),
		customDomain: varchar("custom_domain", { length: 255 }),
		sslEnabled: boolean("ssl_enabled").default(true),
		lastAccessedAt: timestamp("last_accessed_at"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => ({
		userIdIdx: index("idx_deployed_projects_user").on(table.userId),
		apiKeyIdx: index("idx_deployed_projects_api_key").on(table.apiKey),
		statusIdx: index("idx_deployed_projects_status").on(table.deploymentStatus),
	}),
);

// 用户AI凭证表（加密存储）
export const userAiCredentials = pgTable(
	"user_ai_credentials",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("user_id")
			.references(() => users_temp.id)
			.notNull(),
		provider: varchar("provider", { length: 50 }).notNull(),
		encryptedApiKey: text("encrypted_api_key").notNull(),
		keyHash: varchar("key_hash", { length: 64 }).notNull(),
		isActive: boolean("is_active").default(true),
		createdAt: timestamp("created_at").defaultNow(),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => ({
		userProviderIdx: index("idx_ai_creds_user_provider").on(
			table.userId,
			table.provider,
		),
		activeIdx: index("idx_ai_creds_active").on(table.isActive),
	}),
);

// 精确计费记录表
export const billingRecords = pgTable(
	"billing_records",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("user_id")
			.references(() => users_temp.id)
			.notNull(),
		deployedProjectId: text("deployed_project_id").references(
			() => userDeployedProjects.id,
		),
		serviceType: varchar("service_type", { length: 50 }).notNull(),
		quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
		unitPrice: decimal("unit_price", { precision: 18, scale: 8 }).notNull(),
		totalCost: decimal("total_cost", { precision: 18, scale: 8 }).notNull(),
		currency: varchar("currency", { length: 3 }).default("USD"),
		metadata: jsonb("metadata"),
		recordedAt: timestamp("recorded_at").defaultNow(),
	},
	(table) => ({
		userTimeIdx: index("idx_billing_user_time").on(
			table.userId,
			table.recordedAt,
		),
		projectIdx: index("idx_billing_project").on(table.deployedProjectId),
		serviceTypeIdx: index("idx_billing_service_type").on(table.serviceType),
	}),
);

// API配额管理表
export const apiQuotas = pgTable(
	"api_quotas",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("user_id")
			.references(() => users_temp.id)
			.notNull(),
		serviceType: varchar("service_type", { length: 50 }).notNull(),
		dailyLimit: decimal("daily_limit", { precision: 18, scale: 6 }),
		monthlyLimit: decimal("monthly_limit", { precision: 18, scale: 6 }),
		currentDailyUsage: decimal("current_daily_usage", {
			precision: 18,
			scale: 6,
		}).default("0"),
		currentMonthlyUsage: decimal("current_monthly_usage", {
			precision: 18,
			scale: 6,
		}).default("0"),
		resetDate: timestamp("reset_date").notNull(),
		isActive: boolean("is_active").default(true),
	},
	(table) => ({
		userServiceIdx: index("idx_quota_user_service").on(
			table.userId,
			table.serviceType,
		),
	}),
);
