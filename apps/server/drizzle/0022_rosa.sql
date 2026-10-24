CREATE TYPE "public"."player_role" AS ENUM('setter', 'outside', 'middle', 'opposite', 'libero');--> statement-breakpoint
CREATE TYPE "public"."player_source" AS ENUM('league', 'manual');--> statement-breakpoint
CREATE TABLE "player_media" (
	"tenant_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_media_player_id_asset_id_pk" PRIMARY KEY("player_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"number" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "player_role",
	"birth_year" integer,
	"height_cm" integer,
	"birthplace" text,
	"nationality" text,
	"external_key" text,
	"source" "player_source" NOT NULL,
	"edited_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_asset_id" uuid,
	"removed_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_number_check" CHECK ("players"."number" between 0 and 99),
	CONSTRAINT "players_first_name_check" CHECK (char_length("players"."first_name") between 1 and 60),
	CONSTRAINT "players_last_name_check" CHECK (char_length("players"."last_name") between 1 and 60),
	CONSTRAINT "players_height_check" CHECK ("players"."height_cm" is null or "players"."height_cm" between 120 and 250),
	CONSTRAINT "players_nationality_check" CHECK ("players"."nationality" is null or char_length("players"."nationality") <= 3)
);
--> statement-breakpoint
ALTER TABLE "player_media" ADD CONSTRAINT "player_media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_media" ADD CONSTRAINT "player_media_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_media" ADD CONSTRAINT "player_media_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_photo_asset_id_assets_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_media_asset_idx" ON "player_media" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "players_tenant_season_idx" ON "players" USING btree ("tenant_id","season");--> statement-breakpoint
CREATE UNIQUE INDEX "players_tenant_season_key_idx" ON "players" USING btree ("tenant_id","season","external_key") WHERE "players"."external_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "players_tenant_season_number_idx" ON "players" USING btree ("tenant_id","season","number") WHERE "players"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "players_photo_idx" ON "players" USING btree ("photo_asset_id");