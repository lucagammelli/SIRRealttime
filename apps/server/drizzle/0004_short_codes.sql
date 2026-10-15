ALTER TABLE "share_tokens" ADD COLUMN "short_code_hash" text;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD COLUMN "short_code_salt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_short_code_hash_unique" UNIQUE("short_code_hash");