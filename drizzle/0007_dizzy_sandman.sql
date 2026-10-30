ALTER TABLE "tracks" ADD COLUMN "artistId" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artistId_artists_id_fk" FOREIGN KEY ("artistId") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Link existing demos only when the owner has exactly one matching profile.
WITH matches AS (
  SELECT t.id AS track_id, (array_agg(a.id))[1] AS artist_id
  FROM tracks t
  JOIN artists a ON a."ownerId" = t."ownerId"
    AND lower(regexp_replace(a.name, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
      = lower(regexp_replace(t.artist, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  WHERE t."artistId" IS NULL
    AND regexp_replace(t.artist, '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
  GROUP BY t.id
  HAVING count(*) = 1
)
UPDATE tracks t SET "artistId" = m.artist_id
FROM matches m WHERE t.id = m.track_id;
