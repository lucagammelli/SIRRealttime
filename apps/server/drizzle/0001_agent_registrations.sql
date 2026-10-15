CREATE TYPE "public"."agent_registration_status" AS ENUM('pending', 'approved', 'rejected', 'consumed');--> statement-breakpoint
CREATE TABLE "agent_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"pairing_code" text NOT NULL,
	"ip" text,
	"status" "agent_registration_status" DEFAULT 'pending' NOT NULL,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "agent_registrations_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "agent_registrations" ADD CONSTRAINT "agent_registrations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_registrations_status_idx" ON "agent_registrations" USING btree ("status","expires_at");