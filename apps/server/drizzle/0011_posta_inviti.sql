CREATE TABLE "mail_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"password_enc" text,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_singleton_check" CHECK ("mail_settings"."singleton"),
	CONSTRAINT "mail_settings_security_check" CHECK ("mail_settings"."security" in ('none', 'starttls', 'tls')),
	CONSTRAINT "mail_settings_port_check" CHECK ("mail_settings"."port" between 1 and 65535)
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_tokens_kind_check" CHECK ("user_tokens"."kind" in ('invite', 'reset'))
);
--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_tokens_user_kind_idx" ON "user_tokens" USING btree ("user_id","kind");