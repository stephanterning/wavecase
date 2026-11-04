ALTER TABLE "passkeys" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passkeys" ADD COLUMN "lastUsedAt" timestamp with time zone;