ALTER TABLE "links" ADD COLUMN "fromOrder" bigint;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "position" bigserial NOT NULL;--> statement-breakpoint
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM versions) UPDATE versions SET position=ordered.n FROM ordered WHERE versions.id=ordered.id;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('versions','position'), GREATEST(COALESCE((SELECT MAX(position) FROM versions),0),1), EXISTS(SELECT 1 FROM versions));--> statement-breakpoint
UPDATE links SET "fromOrder"=COALESCE((SELECT MIN(position) FROM versions WHERE versions."trackId"=links."trackId" AND versions.created_at>=links."from"),(SELECT COALESCE(MAX(position),0)+1 FROM versions)) WHERE "from" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "links" DROP COLUMN "from";--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_position_unique" UNIQUE("position");