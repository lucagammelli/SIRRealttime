CREATE TABLE "system_logos" (
	"slot" text PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_logos_id_unique" UNIQUE("id"),
	CONSTRAINT "system_logos_slot_check" CHECK ("system_logos"."slot" in ('left', 'right')),
	CONSTRAINT "system_logos_size_check" CHECK ("system_logos"."width" between 1 and 150 and "system_logos"."height" between 1 and 50)
);
