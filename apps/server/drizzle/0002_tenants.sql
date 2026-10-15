ALTER TYPE "public"."user_role" ADD VALUE 'superadmin';--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"hostnames" text[] DEFAULT '{}'::text[] NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"intermissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overlays" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_match_key_unique";--> statement-breakpoint
DROP INDEX "matches_one_live_idx";--> statement-breakpoint
DROP INDEX "agent_registrations_status_idx";--> statement-breakpoint
ALTER TABLE "agent_registrations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
-- Dati esistenti: tutti nel cliente «Predefinito», creato qui (il seed lo ricrea se manca), poi tenant_id NOT NULL.
INSERT INTO "tenants" ("slug", "name") VALUES ('predefinito', 'Predefinito') ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'predefinito');--> statement-breakpoint
UPDATE "agents" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'predefinito');--> statement-breakpoint
UPDATE "agent_registrations" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'predefinito');--> statement-breakpoint
UPDATE "matches" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'predefinito');--> statement-breakpoint
UPDATE "share_tokens" SET "tenant_id" = (SELECT "id" FROM "tenants" WHERE "slug" = 'predefinito');--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_registrations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "share_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "tenants_hostnames_idx" ON "tenants" USING gin ("hostnames");--> statement-breakpoint
ALTER TABLE "agent_registrations" ADD CONSTRAINT "agent_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_tenant_idx" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_tenant_match_key_idx" ON "matches" USING btree ("tenant_id","match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_one_live_per_tenant_idx" ON "matches" USING btree ("tenant_id") WHERE "matches"."live";--> statement-breakpoint
CREATE INDEX "share_tokens_tenant_idx" ON "share_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_registrations_status_idx" ON "agent_registrations" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_role_check" CHECK ((("users"."role")::text = 'superadmin') = ("users"."tenant_id" is null));