import { ArtworkBackdrop } from "../components/artwork-backdrop";
import {
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { ReleaseActivity } from "../components/release-activity";
import {
  ReleaseArtworkEditor,
  ReleaseDetailsEditor,
  TrackListEditor,
} from "../components/release-editors";
import { usePolling } from "../components/use-polling";
import { releasePath } from "../domain/releases";
import { db } from "../server/db";
import { releaseEditorAction } from "../server/release-editor";
import { releaseAccess } from "../server/releases";
import { releaseEvents } from "../server/schema";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const data = await releaseAccess(request, params.id!, true);
  const page = Math.max(
    0,
    Math.min(
      1000000,
      Number(new URL(request.url).searchParams.get("page")) || 0,
    ),
  );
  return {
    ...data,
    page,
    stats: await db
      .select({
        kind: releaseEvents.kind,
        trackId: releaseEvents.trackId,
        detail: releaseEvents.detail,
        count: sql<number>`count(*)::int`,
      })
      .from(releaseEvents)
      .where(
        and(
          eq(releaseEvents.releaseId, data.release.id),
          sql`${releaseEvents.kind} <> 'download-started'`,
        ),
      )
      .groupBy(releaseEvents.kind, releaseEvents.trackId, releaseEvents.detail),
    downloads: await db
      .select()
      .from(releaseEvents)
      .where(
        and(
          eq(releaseEvents.releaseId, data.release.id),
          eq(releaseEvents.kind, "download-started"),
        ),
      )
      .orderBy(desc(releaseEvents.createdAt))
      .limit(50)
      .offset(Math.floor(page) * 50),
  };
}

export function action({ request, params }: ActionFunctionArgs) {
  return releaseEditorAction(request, params.id!);
}

export default function ReleaseEditor() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [search] = useSearchParams();
  const activity = search.get("view") === "activity" || search.has("page");
  usePolling(
    d.tracks.some((t) => t.pendingOriginal),
    3000,
  );
  return (
    <>
      <ArtworkBackdrop
        src={d.release.cover ? `/release-assets/${d.release.id}/cover` : null}
      />
      <header className="music-editor-hero">
        <ReleaseArtworkEditor release={d.release} />
        <div>
          <p className="eyebrow">
            {d.release.published ? "Published" : "Private draft"} ·{" "}
            <Link className="keep-case" to={`/artist-profiles/${d.artist.id}`}>
              {d.artist.name}
            </Link>
          </p>
          <h1>{d.release.title}</h1>
          <p>
            {d.release.kind} ·{" "}
            {d.release.metadata.releaseDate || "Release date not set"}
          </p>
        </div>
      </header>
      <nav className="section-nav" aria-label="Release views">
        <Link to="?" aria-current={!activity ? "page" : undefined}>
          Release page
        </Link>
        <Link to="?view=activity" aria-current={activity ? "page" : undefined}>
          Activity
        </Link>
      </nav>
      {activity ? (
        <ReleaseActivity
          stats={d.stats}
          downloads={d.downloads}
          tracks={d.tracks}
          page={d.page}
        />
      ) : (
        <>
          {result?.error && <p role="alert">{result.error}</p>}
          <ReleaseDetailsEditor
            release={d.release}
            hasTracks={d.tracks.length > 0}
            previewHref={releasePath(d.artist, d.release) + "?preview=1"}
          />
          <TrackListEditor tracks={d.tracks} published={d.release.published} />
        </>
      )}
    </>
  );
}
