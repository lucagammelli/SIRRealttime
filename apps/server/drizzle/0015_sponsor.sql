CREATE TABLE "sponsors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsors_name_check" CHECK (char_length("sponsors"."name") between 1 and 80),
	CONSTRAINT "sponsors_website_check" CHECK ("sponsors"."website" is null or "sponsors"."website" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "sponsor_id" uuid;--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsors_tenant_name_idx" ON "sponsors" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_sponsor_idx" ON "assets" USING btree ("sponsor_id");