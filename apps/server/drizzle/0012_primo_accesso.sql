ALTER TABLE "tenants" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- I clienti già configurati (campionato scelto, profilo del club o grafica salvati) non vedono la procedura guidata.
UPDATE "tenants" SET "onboarded_at" = now()
WHERE EXISTS (SELECT 1 FROM "tenant_leagues" tl WHERE tl."tenant_id" = "tenants"."id")
   OR "club_profile" <> '{}'::jsonb
   OR "branding" <> '{}'::jsonb;
