-- Reversibile (si perdono solo i player creati): DROP TABLE "displays"; DROP TYPE "display_command"; DROP TYPE "display_target";
CREATE TYPE "public"."display_command" AS ENUM('reload', 'reboot', 'screenOff', 'screenOn');--> statement-breakpoint
CREATE TYPE "public"."display_target" AS ENUM('none', 'channel', 'match', 'fixture');--> statement-breakpoint
CREATE TABLE "displays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"target_kind" "display_target" DEFAULT 'none' NOT NULL,
	"match_id" uuid,
	"client_fixture_id" uuid,
	"command" "display_command",
	"command_seq" integer DEFAULT 0 NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"version" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "displays_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "displays_target_check" CHECK (("displays"."target_kind" = 'match' or "displays"."match_id" is null) and ("displays"."target_kind" = 'fixture' or "displays"."client_fixture_id" is null))
);
--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_client_fixture_id_client_fixtures_id_fk" FOREIGN KEY ("client_fixture_id") REFERENCES "public"."client_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "displays_tenant_idx" ON "displays" USING btree ("tenant_id");