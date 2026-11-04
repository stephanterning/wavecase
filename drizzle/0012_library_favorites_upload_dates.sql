CREATE TABLE "track_favorites" (
	"userId" uuid NOT NULL,
	"trackId" uuid NOT NULL,
	CONSTRAINT "track_favorites_userId_trackId_pk" PRIMARY KEY("userId","trackId")
);
--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "pendingUploadedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "uploadedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "track_favorites" ADD CONSTRAINT "track_favorites_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_favorites" ADD CONSTRAINT "track_favorites_trackId_tracks_id_fk" FOREIGN KEY ("trackId") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Historical replacement times were not recorded; retain the known upload date.
UPDATE "versions" SET "uploadedAt" = "created_at"
WHERE "state" IN ('ready', 'missing') OR "original" IS NOT NULL OR "playback" IS NOT NULL;
--> statement-breakpoint
UPDATE "versions" SET "pendingUploadedAt" = "created_at" WHERE "pendingOriginal" IS NOT NULL;
