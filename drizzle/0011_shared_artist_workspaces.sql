CREATE TABLE "artist_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"artistId" uuid NOT NULL,
	"label" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artistId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "linkId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "authorId" uuid;--> statement-breakpoint
ALTER TABLE "artist_invitations" ADD CONSTRAINT "artist_invitations_artistId_artists_id_fk" FOREIGN KEY ("artistId") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_members" ADD CONSTRAINT "artist_members_artistId_artists_id_fk" FOREIGN KEY ("artistId") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_members" ADD CONSTRAINT "artist_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artist_member_account" ON "artist_members" USING btree ("artistId","userId");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_users_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;