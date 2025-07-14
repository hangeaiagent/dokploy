CREATE TABLE "ai_marketplace_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"github_url" varchar(255) NOT NULL,
	"stars" integer DEFAULT 0,
	"forks" integer DEFAULT 0,
	"language" varchar(50),
	"framework" varchar(100),
	"category" varchar(100),
	"tags" text[],
	"logo_url" varchar(255),
	"is_featured" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_marketplace_projects_github_url_unique" UNIQUE("github_url")
);
--> statement-breakpoint
CREATE TABLE "api_quotas" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service_type" varchar(50) NOT NULL,
	"daily_limit" numeric(18, 6),
	"monthly_limit" numeric(18, 6),
	"current_daily_usage" numeric(18, 6) DEFAULT '0',
	"current_monthly_usage" numeric(18, 6) DEFAULT '0',
	"reset_date" timestamp NOT NULL,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "billing_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deployed_project_id" text,
	"service_type" varchar(50) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_price" numeric(18, 8) NOT NULL,
	"total_cost" numeric(18, 8) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"metadata" jsonb,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_ai_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(50) NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_deployed_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dokploy_application_id" text NOT NULL,
	"github_url" varchar(255) NOT NULL,
	"api_key" varchar(64) NOT NULL,
	"analysis_cache" jsonb,
	"deployment_status" varchar(50) DEFAULT 'created',
	"custom_domain" varchar(255),
	"ssl_enabled" boolean DEFAULT true,
	"last_accessed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_deployed_projects_dokploy_application_id_unique" UNIQUE("dokploy_application_id"),
	CONSTRAINT "user_deployed_projects_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
ALTER TABLE "api_quotas" ADD CONSTRAINT "api_quotas_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_deployed_project_id_user_deployed_projects_id_fk" FOREIGN KEY ("deployed_project_id") REFERENCES "public"."user_deployed_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ai_credentials" ADD CONSTRAINT "user_ai_credentials_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_deployed_projects" ADD CONSTRAINT "user_deployed_projects_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_deployed_projects" ADD CONSTRAINT "user_deployed_projects_dokploy_application_id_application_applicationId_fk" FOREIGN KEY ("dokploy_application_id") REFERENCES "public"."application"("applicationId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_marketplace_category" ON "ai_marketplace_projects" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_marketplace_language" ON "ai_marketplace_projects" USING btree ("language");--> statement-breakpoint
CREATE INDEX "idx_marketplace_stars" ON "ai_marketplace_projects" USING btree ("stars");--> statement-breakpoint
CREATE INDEX "idx_marketplace_active" ON "ai_marketplace_projects" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_quota_user_service" ON "api_quotas" USING btree ("user_id","service_type");--> statement-breakpoint
CREATE INDEX "idx_billing_user_time" ON "billing_records" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_billing_project" ON "billing_records" USING btree ("deployed_project_id");--> statement-breakpoint
CREATE INDEX "idx_billing_service_type" ON "billing_records" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX "idx_ai_creds_user_provider" ON "user_ai_credentials" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "idx_ai_creds_active" ON "user_ai_credentials" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_deployed_projects_user" ON "user_deployed_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_deployed_projects_api_key" ON "user_deployed_projects" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX "idx_deployed_projects_status" ON "user_deployed_projects" USING btree ("deployment_status");