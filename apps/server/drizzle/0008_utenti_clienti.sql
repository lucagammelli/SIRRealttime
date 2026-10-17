ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "tenants" SET "agent_quota" = least(100, greatest(0, "agent_quota")) WHERE "agent_quota" NOT BETWEEN 0 AND 100;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agent_quota_check" CHECK ("tenants"."agent_quota" between 0 and 100);
