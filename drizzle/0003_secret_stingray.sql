CREATE TABLE "reupload_requests" (
	"linkId" text PRIMARY KEY NOT NULL,
	"trackId" uuid NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracks" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "reupload_requests" ADD CONSTRAINT "reupload_requests_linkId_links_id_fk" FOREIGN KEY ("linkId") REFERENCES "public"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reupload_requests" ADD CONSTRAINT "reupload_requests_trackId_tracks_id_fk" FOREIGN KEY ("trackId") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;