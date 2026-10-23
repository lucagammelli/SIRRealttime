-- Reversibile (nessun dato perso oltre ai nomi): ALTER TABLE "assets" DROP CONSTRAINT "assets_name_check"; ALTER TABLE "assets" DROP COLUMN "name";
ALTER TABLE "assets" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_name_check" CHECK ("assets"."name" is null or char_length("assets"."name") between 1 and 120);