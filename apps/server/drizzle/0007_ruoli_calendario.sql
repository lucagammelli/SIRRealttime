CREATE TYPE "public"."fixture_broadcast" AS ENUM('auto', 'on', 'off');--> statement-breakpoint
CREATE TYPE "public"."fixture_origin" AS ENUM('league', 'manual');--> statement-breakpoint
CREATE TYPE "public"."manual_fixture_kind" AS ENUM('friendly', 'cup', 'other');--> statement-breakpoint
ALTER TABLE "client_fixtures" ALTER COLUMN "league_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_registrations" ADD COLUMN "agent_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "origin" "fixture_origin" DEFAULT 'league' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "manual_kind" "manual_fixture_kind";--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "broadcast" "fixture_broadcast" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "our_logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD COLUMN "opponent_logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "club_profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_quota" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_our_logo_asset_id_assets_id_fk" FOREIGN KEY ("our_logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_opponent_logo_asset_id_assets_id_fk" FOREIGN KEY ("opponent_logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_origin_league_check" CHECK (("client_fixtures"."origin" = 'manual') = ("client_fixtures"."league_id" is null));--> statement-breakpoint
UPDATE "tenants" SET "agent_quota" = greatest(1, (SELECT count(*) FROM "agents" WHERE "agents"."tenant_id" = "tenants"."id" AND NOT "agents"."revoked"));
