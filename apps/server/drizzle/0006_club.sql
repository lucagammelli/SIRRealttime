CREATE TYPE "public"."club_side" AS ENUM('home', 'away');--> statement-breakpoint
CREATE TYPE "public"."fixture_link" AS ENUM('auto', 'manual', 'pending', 'none');--> statement-breakpoint
CREATE TABLE "client_fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"fixture_external_id" text NOT NULL,
	"fixture_id" uuid,
	"removed_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"our_side" "club_side" NOT NULL,
	"home_name" text NOT NULL,
	"away_name" text NOT NULL,
	"home_city" text,
	"away_city" text,
	"home_logo_id" uuid,
	"away_logo_id" uuid,
	"venue" text,
	"venue_city" text,
	"round_label" text NOT NULL,
	"league_name" text,
	"status" "fixture_status" NOT NULL,
	"home_sets" integer,
	"away_sets" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"league_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "matches_one_live_per_tenant_idx";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "live_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "client_fixture_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "fixture_link" "fixture_link";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "fixture_candidates" jsonb;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD COLUMN "client_fixture_id" uuid;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_home_logo_id_team_logos_id_fk" FOREIGN KEY ("home_logo_id") REFERENCES "public"."team_logos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_fixtures" ADD CONSTRAINT "client_fixtures_away_logo_id_team_logos_id_fk" FOREIGN KEY ("away_logo_id") REFERENCES "public"."team_logos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_leagues" ADD CONSTRAINT "tenant_leagues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_leagues" ADD CONSTRAINT "tenant_leagues_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_leagues" ADD CONSTRAINT "tenant_leagues_league_team_id_league_teams_id_fk" FOREIGN KEY ("league_team_id") REFERENCES "public"."league_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_fixtures_tenant_fixture_idx" ON "client_fixtures" USING btree ("tenant_id","league_id","fixture_external_id");--> statement-breakpoint
CREATE INDEX "client_fixtures_tenant_starts_idx" ON "client_fixtures" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_leagues_tenant_league_idx" ON "tenant_leagues" USING btree ("tenant_id","league_id");--> statement-breakpoint
CREATE INDEX "tenant_leagues_league_idx" ON "tenant_leagues" USING btree ("league_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_client_fixture_id_client_fixtures_id_fk" FOREIGN KEY ("client_fixture_id") REFERENCES "public"."client_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_client_fixture_id_client_fixtures_id_fk" FOREIGN KEY ("client_fixture_id") REFERENCES "public"."client_fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_one_live_per_fixture_idx" ON "matches" USING btree ("client_fixture_id") WHERE "matches"."live" and "matches"."client_fixture_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_one_live_unlinked_idx" ON "matches" USING btree ("tenant_id") WHERE "matches"."live" and "matches"."client_fixture_id" is null;--> statement-breakpoint
CREATE INDEX "matches_client_fixture_idx" ON "matches" USING btree ("client_fixture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_tokens_client_fixture_idx" ON "share_tokens" USING btree ("client_fixture_id") WHERE "share_tokens"."client_fixture_id" is not null;--> statement-breakpoint
UPDATE "matches" SET "live_since" = "updated_at" WHERE "live";