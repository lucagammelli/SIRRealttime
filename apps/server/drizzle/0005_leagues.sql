CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'played', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."league_provider" AS ENUM('legavolley');--> statement-breakpoint
CREATE TYPE "public"."league_sync_status" AS ENUM('never', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"number" integer,
	"phase_id" integer NOT NULL,
	"phase" text NOT NULL,
	"round" integer,
	"round_label" text NOT NULL,
	"starts_at" timestamp with time zone,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"venue" text,
	"venue_city" text,
	"venue_address" text,
	"status" "fixture_status" NOT NULL,
	"home_sets" integer,
	"away_sets" integer,
	"set_scores" jsonb,
	"provider_match_id" integer,
	"note" text,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_http_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"etag" text,
	"last_modified" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"external_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"city" text,
	"venue" text,
	"venue_address" text,
	"logo_id" uuid,
	"details_fetched_at" timestamp with time zone,
	"logo_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "league_provider" NOT NULL,
	"external_id" integer NOT NULL,
	"season" integer NOT NULL,
	"name" text,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" "league_sync_status" DEFAULT 'never' NOT NULL,
	"last_message" text,
	"sync_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"league_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"team_id" uuid,
	"team_name" text NOT NULL,
	"points" integer NOT NULL,
	"played" integer NOT NULL,
	"won" integer NOT NULL,
	"lost" integer NOT NULL,
	"sets_won" integer NOT NULL,
	"sets_lost" integer NOT NULL,
	"points_for" integer NOT NULL,
	"points_against" integer NOT NULL,
	"set_ratio" real,
	"point_ratio" real,
	"by_result" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standings_league_id_position_pk" PRIMARY KEY("league_id","position")
);
--> statement-breakpoint
CREATE TABLE "team_logos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_logos_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_id_league_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_id_league_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_logo_id_team_logos_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."team_logos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_team_id_league_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."league_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_league_external_idx" ON "fixtures" USING btree ("league_id","external_id");--> statement-breakpoint
CREATE INDEX "fixtures_starts_at_idx" ON "fixtures" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "league_teams_league_external_idx" ON "league_teams" USING btree ("league_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_provider_external_idx" ON "leagues" USING btree ("provider","external_id");