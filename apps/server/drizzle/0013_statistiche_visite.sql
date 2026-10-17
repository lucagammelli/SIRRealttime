CREATE TABLE "page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"share_token_id" uuid,
	"client_fixture_id" uuid,
	"match_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"device" text NOT NULL,
	"source" text NOT NULL,
	"app" boolean NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "page_views_device_check" CHECK ("page_views"."device" in ('tv', 'tablet', 'phone')),
	CONSTRAINT "page_views_source_check" CHECK ("page_views"."source" in ('qr', 'link')),
	CONSTRAINT "page_views_seconds_check" CHECK ("page_views"."seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "view_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"share_token_id" uuid,
	"match_id" uuid,
	"visits" integer NOT NULL,
	"qr_visits" integer NOT NULL,
	"app_visits" integer NOT NULL,
	"tv_visits" integer NOT NULL,
	"tablet_visits" integer NOT NULL,
	"phone_visits" integer NOT NULL,
	"seconds" bigint NOT NULL,
	"peak" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewer_peaks" (
	"tenant_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"viewers" integer NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "viewer_peaks_match_id_minute_pk" PRIMARY KEY("match_id","minute"),
	CONSTRAINT "viewer_peaks_viewers_check" CHECK ("viewer_peaks"."viewers" > 0)
);
--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_share_token_id_share_tokens_id_fk" FOREIGN KEY ("share_token_id") REFERENCES "public"."share_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_client_fixture_id_client_fixtures_id_fk" FOREIGN KEY ("client_fixture_id") REFERENCES "public"."client_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_daily" ADD CONSTRAINT "view_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_daily" ADD CONSTRAINT "view_daily_share_token_id_share_tokens_id_fk" FOREIGN KEY ("share_token_id") REFERENCES "public"."share_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_daily" ADD CONSTRAINT "view_daily_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_peaks" ADD CONSTRAINT "viewer_peaks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_peaks" ADD CONSTRAINT "viewer_peaks_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_views_tenant_day_idx" ON "page_views" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "view_daily_tenant_day_idx" ON "view_daily" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "viewer_peaks_tenant_day_idx" ON "viewer_peaks" USING btree ("tenant_id","day");