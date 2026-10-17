ALTER TABLE "client_fixtures" ADD COLUMN "override_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "overridden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "override_official_starts_at" timestamp with time zone;