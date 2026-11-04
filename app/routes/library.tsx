import { demoList } from "../server/demo-list";
import { DemoList } from "../components/demo-list";
import { useRef, useEffect } from "react";
import { TrackArtistField } from "../components/track-artist-field";
import { artistChoices, resolveTrackArtist } from "../server/track-artist";
import { uploadVersion } from "../server/upload";
import { limitedBody } from "../server/request";
import { defaultVersionStatus, versionStatuses } from "../domain/versions";
import { redirect } from "react-router";
import {
  Form,
  useLoaderData,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { db } from "../server/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { trackScope } from "../server/ownership";
import { trackFavorites, tracks } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    user,
    artists: await artistChoices(user.id),
    ...(await demoList(user.id)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  if (form.get("intent") === "favorite") {
    const trackId = z.uuid().safeParse(form.get("trackId"));
    const favorite = form.get("favorite");
    if (!trackId.success || (favorite !== "1" && favorite !== "0"))
      return { error: "Choose a track and favorite state." };
    await db.transaction(async (tx) => {
      const [track] = await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.id, trackId.data), trackScope(user.id)))
        .for("update");
      if (!track) throw new Response("Not found", { status: 404 });
      if (favorite === "1")
        await tx
          .insert(trackFavorites)
          .values({ userId: user.id, trackId: track.id })
          .onConflictDoNothing();
      else
        await tx
          .delete(trackFavorites)
          .where(
            and(
              eq(trackFavorites.userId, user.id),
              eq(trackFavorites.trackId, track.id),
            ),
          );
    });
    return { error: undefined };
  }
  const title = String(form.get("title") || "").trim();
  if (!title || title.length > 200)
    return { error: "Enter a title of up to 200 characters." };
  let artist;
  try {
    artist = await resolveTrackArtist(user.id, form);
  } catch (error) {
    if (error instanceof Response && error.status === 400)
      return { error: await error.text() };
    throw error;
  }
  const [track] = await db
    .insert(tracks)
    .values({ ownerId: user.id, title, ...artist })
    .returning();
  const file = form.get("audio");
  if (file instanceof File && file.size) await uploadVersion(track.id, form);
  return redirect("/tracks/" + track.id);
}
export default function Library() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const [search] = useSearchParams();
  const dialog = useRef<HTMLDialogElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      (result?.error || search.get("create") === "1") &&
      !dialog.current?.open
    )
      dialog.current?.showModal();
  }, [result, search]);
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h1>Work in progress</h1>
        </div>
      </div>
      <DemoList data={data}>
        <button
          ref={createTrigger}
          type="button"
          onClick={() => dialog.current?.showModal()}
        >
          Add new track
        </button>
      </DemoList>
      <dialog
        ref={dialog}
        onClose={() => createTrigger.current?.focus()}
        className="comment-dialog"
        aria-labelledby="new-track-title"
      >
        <Form method="post" encType="multipart/form-data" className="panel">
          <h2 id="new-track-title">Add new track</h2>

          <label>
            First audio version (optional)
            <input
              type="file"
              name="audio"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const title = e.target.form?.elements.namedItem("title");
                if (file && title instanceof HTMLInputElement && !title.value)
                  title.value = file.name
                    .replace(/\.[^.]+$/, "")
                    .replace(/[ _-]+v\d+(?:\.\d+)*$/i, "")
                    .replace(/_/g, " ");
              }}
            />
          </label>
          <label>
            Title
            <input name="title" required maxLength={200} />
          </label>
          <label>
            First version status
            <select name="status" defaultValue={defaultVersionStatus}>
              {versionStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <TrackArtistField profiles={data.artists} />
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="button-primary"
              disabled={navigation.state !== "idle"}
            >
              {navigation.state !== "idle" ? "Creating…" : "Create track"}
            </button>
          </div>
          {result?.error && <p role="alert">{result.error}</p>}
        </Form>
      </dialog>
    </>
  );
}
