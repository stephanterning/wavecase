import { ArtworkBackdrop } from "../components/artwork-backdrop";
import { DemoIdentity } from "../components/demo-editors";
import { ShareLinks } from "../components/share-links";
import { OwnerTrackActions } from "../components/owner-track-actions";
import {
  ReuploadRequests,
  RequestReupload,
} from "../components/reupload-requests";
import { VersionPlayerPanel } from "../components/version-player-panel";
import { demoWavAvailable } from "../server/download";
import { artistChoices } from "../server/track-artist";
import { trackPage } from "../server/track-page";
import { demoMutation } from "../server/demo-mutations";
import { dataDir } from "../server/config";
import { useWorkspacePlayback } from "../components/workspace-player";
import type { Playback } from "../components/player";
import { Feedback } from "../components/feedback";
import type { CommentDraft } from "../components/comment-dialog";
import {
  useLoaderData,
  useRevalidator,
  useActionData,
  useSearchParams,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  sql,
} from "drizzle-orm";
import { recordVisit } from "../components/telemetry";
import { useEffect, useRef, useState } from "react";
import { db } from "../server/db";
import { versions, links, reuploadRequests, events } from "../server/schema";
import { requireUser } from "../server/security";
export const meta = () => [{ title: "Wavecase" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { access, visible, page, fingerprint } = await trackPage(
    request,
    params,
  );
  const id = access.track.id;
  const peaks = new Map(
    (
      await db
        .select({ id: versions.id, peaks: versions.peaks })
        .from(versions)
        .where(
          inArray(
            versions.id,
            visible.map((v) => v.id),
          ),
        )
    ).map((v) => [v.id, v.peaks]),
  );
  return {
    ...page,
    fingerprint,
    artists: access.owner
      ? await artistChoices((await requireUser(request)).id)
      : [],
    requests: access.owner
      ? await db
          .select()
          .from(reuploadRequests)
          .where(eq(reuploadRequests.trackId, id))
      : [],
    versions: await Promise.all(
      page.versions.map(async (v, i) => ({
        ...v,
        peaks: peaks.get(v.id) ?? null,
        wavDownload: await demoWavAvailable(visible[i], dataDir()).catch(
          () => false,
        ),
      })),
    ),
    links: access.owner
      ? await db
          .select({
            ...getTableColumns(links),
            plays: sql<number>`(${db
              .select({ value: count() })
              .from(events)
              .where(
                and(eq(events.linkId, links.id), eq(events.kind, "play")),
              )})`.mapWith(Number),
            downloads: sql<number>`(${db
              .select({ value: count() })
              .from(events)
              .where(
                and(
                  eq(events.linkId, links.id),
                  eq(events.kind, "download-started"),
                ),
              )})`.mapWith(Number),
          })
          .from(links)
          .where(eq(links.trackId, id))
          .orderBy(desc(links.createdAt), links.id)
      : [],
  };
}
export function action(args: ActionFunctionArgs) {
  return demoMutation(args);
}
export default function Track() {
  const data = useLoaderData<typeof loader>();
  return <TrackContents key={data.track.id} />;
}
function TrackContents() {
  const workspace = useWorkspacePlayback();
  const data = useLoaderData<typeof loader>();
  const result = useActionData<{ error?: string; requested?: boolean }>();
  const available = data.versions
    .filter((v) => v.state === "ready")
    .map((v) => v.id + v.revision)
    .join(",");
  useEffect(() => {
    const active = workspace?.getSnapshot();
    if (active?.trackId === data.track.id)
      active.playback?.reconcile(available.split(","));
  }, [workspace, data.track.id, available]);
  const visitedShare = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      data.share &&
      !data.owner &&
      !data.preview &&
      visitedShare.current !== data.share
    ) {
      visitedShare.current = data.share;
      recordVisit(data.share);
    }
  }, [data.share, data.owner, data.preview]);
  const [search] = useSearchParams();
  const [selection, setSelection] = useState(
    () =>
      search.get("version") ||
      (workspace?.getSnapshot().trackId === data.track.id
        ? workspace.getSnapshot().playback?.getSnapshot().source?.versionId
        : undefined) ||
      data.versions.find((v) => v.state === "ready")?.id ||
      data.versions[0]?.id ||
      "",
  );
  const requestedVersion = search.get("version");
  const [appliedVersion, setAppliedVersion] = useState(requestedVersion);
  if (requestedVersion !== appliedVersion) {
    setAppliedVersion(requestedVersion);
    if (requestedVersion) setSelection(requestedVersion);
  }
  const cursor = useRef<Playback>({
    position: 0,
    playing: false,
  });
  const [seekRequest, setSeekRequest] = useState<{
    versionId: string;
    position: number;
  } | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const current =
    data.versions.find((v) => v.id === selection) ||
    data.versions.find((v) => v.state === "ready") ||
    data.versions[0];
  const previousVersion = useRef(current?.id);
  useEffect(() => {
    if (
      data.owner &&
      previousVersion.current &&
      !data.versions.some((v) => v.id === previousVersion.current)
    )
      document
        .getElementById(current ? "edit-version" : "upload-new-version")
        ?.focus();
    previousVersion.current = current?.id;
  }, [current, data.owner, data.versions]);
  const revalidator = useRevalidator();
  const artwork = data.track.cover
    ? `/cover/${data.track.id}?v=${data.track.coverRevision}${data.share ? "&share=" + data.share : ""}${data.preview ? "&preview=1" : ""}`
    : undefined;
  const statusUrl = data.share
    ? `/s/${encodeURIComponent(data.share)}/status${data.preview ? "?preview=1" : ""}`
    : `/tracks/${data.track.id}/status`;
  useEffect(() => {
    if (
      data.owner &&
      !data.versions.some((v) => v.state === "processing" || v.processing)
    )
      return;
    const timer = setInterval(
      async () => {
        const response = await fetch(statusUrl).catch(() => null);
        if (!response) return;
        const status = response.ok
          ? await response.json().catch(() => null)
          : null;
        if (status?.fingerprint !== data.fingerprint)
          void revalidator.revalidate();
      },
      data.owner ? 3000 : 30000,
    );
    return () => clearInterval(timer);
  }, [data.versions, data.owner, data.fingerprint, statusUrl, revalidator]);
  return (
    <>
      <ArtworkBackdrop src={artwork} />
      {data.owner && data.share && (
        <p>
          <a href={`/tracks/${data.track.id}`}>Back to editing</a>
        </p>
      )}
      <DemoIdentity data={data} artwork={artwork} />
      {data.owner && (
        <OwnerTrackActions versions={data.versions} onUploaded={setSelection} />
      )}
      {result?.error && <p role="alert">{result.error}</p>}
      {!data.owner && !data.versions.length && (
        <p role="status">No version is available through this link.</p>
      )}
      {!data.owner &&
        !!data.versions.length &&
        !data.versions.some((v) => v.state === "ready") && (
          <RequestReupload
            preview={data.preview}
            requested={result?.requested}
          />
        )}
      {data.owner && (
        <ReuploadRequests
          trackId={data.track.id}
          requests={data.requests}
          links={data.links}
          versions={data.versions}
        />
      )}
      {current && (
        <VersionPlayerPanel
          data={data}
          version={current}
          artwork={artwork}
          seekRequest={seekRequest}
          playbackRef={cursor}
          onSelect={(id) => {
            setSelection(id);
            setDraft(null);
          }}
          onComment={setDraft}
        />
      )}
      {data.owner && (
        <ShareLinks
          trackId={data.track.id}
          links={data.links}
          versions={data.versions}
        />
      )}
      {current && (
        <Feedback
          versionId={current.id}
          share={data.share}
          owner={data.owner}
          preview={data.preview}
          draft={
            data.versions.some((v) => v.id === draft?.versionId) ? draft : null
          }
          onDraftChange={setDraft}
          onSeek={(id, time) => {
            if (current.id !== id) setSelection(id);
            cursor.current.position = time;
            setSeekRequest({ versionId: id, position: time });
          }}
          links={data.links}
          versions={data.versions}
        />
      )}{" "}
    </>
  );
}
