import { useEffect, useState } from "react";
import { browserIdentity } from "./telemetry";
import { CommentDialog, type CommentDraft } from "./comment-dialog";
const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Comment = {
  id: string;
  versionId: string;
  threadId: string | null;
  linkId: string;
  name: string;
  body: string | null;
  start: number | null;
  end: number | null;
  owner: boolean;
  canDelete: boolean;
  createdAt: string;
  isNew?: boolean;
};
export function Feedback({
  versionId,
  share,
  owner,
  links,
  versions,
  draft,
  onDraftChange,
  onSeek,
}: {
  versionId: string;
  share?: string;
  owner: boolean;
  links: { id: string; label: string }[];
  versions: { id: string; name: string; state: string }[];
  draft: CommentDraft | null;
  onDraftChange: (draft: CommentDraft | null) => void;
  onSeek: (id: string, time: number) => void;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("all");
  const [allVersions, setAllVersions] = useState(false);
  const versionIds =
    allVersions && owner ? versions.map((v) => v.id).join(",") : versionId;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      versionIds.split(",").map((id) =>
        fetch("/feedback/" + id + (share ? "?share=" + share : ""), {
          signal: controller.signal,
          headers: {
            "X-Comment-Secret":
              localStorage.getItem("wavecase.commentSecret") || "",
          },
        }).then((r) => {
          if (!r.ok) {
            if (r.status === 403 || r.status === 404)
              window.dispatchEvent(new Event("wavecase-access-revoked"));
            throw new Error("Could not load feedback");
          }
          return r.json() as Promise<Comment[]>;
        }),
      ),
    )
      .then((groups) => {
        const collected = groups.flat().map((item) => {
          const key =
            "wavecase.seen." + (share || "owner") + "." + item.versionId;
          const seen = localStorage.getItem(key);
          return {
            ...item,
            isNew: !!seen && new Date(item.createdAt).getTime() > Number(seen),
          };
        });
        setItems(collected);
        for (const id of versionIds.split(","))
          localStorage.setItem(
            "wavecase.seen." + (share || "owner") + "." + id,
            String(Date.now()),
          );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [versionIds, share, revision]);
  const visibleItems = items.filter(
    (item) =>
      versionIds.split(",").includes(item.versionId) &&
      (owner || item.linkId === share),
  );
  async function send(form: HTMLFormElement, draft: CommentDraft) {
    const values = new FormData(form);
    let secret = localStorage.getItem("wavecase.commentSecret");
    if (!secret) {
      secret = crypto.randomUUID() + crypto.randomUUID();
      localStorage.setItem("wavecase.commentSecret", secret);
    }
    const name = String(
      values.get("name") || localStorage.getItem("wavecase.name") || "Uploader",
    );
    if (!owner) localStorage.setItem("wavecase.name", name);
    try {
      const { threadId, versionId: targetVersion } = draft;
      const r = await fetch(
        "/feedback/" + targetVersion + (share ? "?share=" + share : ""),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            browser: browserIdentity(),
            name,
            secret,
            body: values.get("body"),
            threadId,
            start: values.get("start") ? Number(values.get("start")) : null,
            end: values.get("end") ? Number(values.get("end")) : null,
          }),
        },
      );
      if (!r.ok)
        throw new Error("Could not save feedback. Please check the fields.");
      form.reset();
      setRevision((v) => v + 1);
      setError("");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }
  async function remove(comment: Comment) {
    const response = await fetch(
      "/feedback/" + comment.versionId + (share ? "?share=" + share : ""),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delete: comment.id,
          secret: localStorage.getItem("wavecase.commentSecret"),
        }),
      },
    );
    if (response.ok) setRevision((v) => v + 1);
    else setError("Could not delete this comment.");
  }
  return (
    <section className="panel">
      <h2>Feedback</h2>
      {owner && (
        <label>
          Versions
          <select
            value={allVersions ? "all" : "selected"}
            onChange={(e) => setAllVersions(e.target.value === "all")}
          >
            <option value="selected">Selected version</option>
            <option value="all">All versions</option>
          </select>
        </label>
      )}
      {owner && (
        <label>
          Share link
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All links</option>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {visibleItems
        .filter((c) => !c.threadId && (filter === "all" || c.linkId === filter))
        .map((c) => (
          <article className="panel" key={c.id}>
            {owner && (
              <p className="eyebrow">
                {versions.find((v) => v.id === c.versionId)?.name} ·{" "}
                {links.find((l) => l.id === c.linkId)?.label}
              </p>
            )}
            <p>
              <strong>{c.name}</strong>
              {c.isNew && <span className="eyebrow"> New</span>}{" "}
              {c.start !== null
                ? `${timestamp(c.start)}${c.end !== null ? "–" + timestamp(c.end) : ""}`
                : "Whole version"}
            </p>
            {c.start !== null && (
              <button
                className="secondary"
                disabled={
                  versions.find((v) => v.id === c.versionId)?.state !== "ready"
                }
                onClick={() => onSeek(c.versionId, c.start!)}
              >
                Listen here
              </button>
            )}
            <p>{c.body || "deleted"}</p>
            {c.canDelete && c.body && (
              <button className="secondary" onClick={() => void remove(c)}>
                Delete
              </button>
            )}
            {visibleItems
              .filter((r) => r.threadId === c.id)
              .map((r) => (
                <blockquote key={r.id}>
                  <strong>
                    {r.name}
                    {r.isNew ? " · New" : ""}
                    {r.owner ? " · Uploader" : ""}
                  </strong>
                  <p>{r.body || "deleted"}</p>
                  {r.canDelete && r.body && (
                    <button
                      className="secondary"
                      onClick={() => void remove(r)}
                    >
                      Delete
                    </button>
                  )}
                </blockquote>
              ))}
            <button
              className="secondary"
              onClick={() => {
                setError("");
                onDraftChange({
                  versionId: c.versionId,
                  threadId: c.id,
                  start: null,
                  end: null,
                });
              }}
            >
              Reply in this thread
            </button>
          </article>
        ))}
      {!visibleItems.length && (
        <p className="muted">No feedback on this version yet.</p>
      )}
      {draft && (
        <CommentDialog
          key={draft.versionId + (draft.threadId || "new")}
          draft={draft}
          owner={owner}
          versionName={
            versions.find((v) => v.id === draft.versionId)?.name || "Version"
          }
          error={error}
          onSubmit={send}
          onClose={() => {
            setError("");
            onDraftChange(null);
          }}
        />
      )}
    </section>
  );
}
