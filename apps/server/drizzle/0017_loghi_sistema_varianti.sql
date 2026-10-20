ALTER TABLE "system_logos" ADD COLUMN "variant" text DEFAULT 'positive' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_logos" DROP CONSTRAINT "system_logos_pkey";--> statement-breakpoint
ALTER TABLE "system_logos" ADD CONSTRAINT "system_logos_slot_variant_pk" PRIMARY KEY("slot","variant");--> statement-breakpoint
ALTER TABLE "system_logos" ADD CONSTRAINT "system_logos_variant_check" CHECK ("system_logos"."variant" in ('positive', 'negative'));
