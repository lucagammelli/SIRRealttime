DROP INDEX "share_tokens_client_fixture_idx";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "match_links_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "share_tokens_client_fixture_idx" ON "share_tokens" USING btree ("client_fixture_id") WHERE "share_tokens"."client_fixture_id" is not null and not "share_tokens"."revoked";--> statement-breakpoint
-- Clients that already have links of single matches (not revoked, simulations aside) keep them: the option starts on.
UPDATE "tenants" SET "match_links_enabled" = true WHERE EXISTS (SELECT 1 FROM "share_tokens" s WHERE s."tenant_id" = "tenants"."id" AND NOT s."revoked" AND (s."client_fixture_id" IS NOT NULL OR (s."match_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "matches" m WHERE m."id" = s."match_id" AND m."simulated"))));
