import type { RefObject } from "react";
import type { loader } from "../routes/track";
import type { CommentDraft } from "./comment-dialog";
import { ReplaceAudio, VersionEditor } from "./demo-editors";
import { Download } from "./download";
import { IconButton } from "./icon-button";
import { Player, type Playback } from "./player";

type Data = Awaited<ReturnType<typeof loader>>;
type Version = Data["versions"][number];
const metrics = [
  ["LUFS", "lufs"],
  ["Peak (dBFS)", "peak"],
  ["True peak (dBTP)", "truePeak"],
  ["LRA (LU)", "lra"],
];

export function VersionPlayerPanel({
  data,
  version,
  artwork,
  seekRequest,
  playbackRef,
  repeat,
  onRepeatChange,
  onSelect,
  onComment,
}: {
  data: Data;
  version: Version;
  artwork?: string;
  seekRequest: { versionId: string; position: number } | null;
  playbackRef: RefObject<Playback>;
  repeat: boolean;
  onRepeatChange: (repeat: boolean) => void;
  onSelect: (versionId: string) => void;
  onComment: (draft: CommentDraft) => void;
}) {
  return (
    <section className="panel player-panel">
      <div className="version-heading">
        {data.versions.length > 1 ? (
          <label className="version-picker">
            <span className="sr-only">Version</span>
            <span className="version-select-size">
              <span aria-hidden="true">{version.name}</span>
              <select
                value={version.id}
                onChange={(e) => onSelect(e.target.value)}
              >
                {data.versions.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ) : (
          <span className="version-name">{version.name}</span>
        )}
        {data.owner && (
          <VersionEditor trackId={data.track.id} version={version} />
        )}
      </div>
      <p>
        {version.status}
        {data.owner &&
          ` · ${version.download ? "Downloads allowed" : "Downloads disabled"}`}
      </p>
      {version.description && (
        <p className="demo-description">{version.description}</p>
      )}
      {data.owner && version.processing && version.state !== "processing" && (
        <p role="status">Processing replacement audio…</p>
      )}
      {data.owner && version.error && <p role="alert">{version.error}</p>}
      <div className="metrics">
        {metrics.map(([label, key]) => (
          <span key={key}>
            {label}{" "}
            <strong>
              {version.state === "ready" &&
              typeof version.metadata?.[key] === "number"
                ? Number(version.metadata[key]).toFixed(1)
                : "—"}
            </strong>
          </span>
        ))}
      </div>
      <div className="demo-waveform">
        {data.owner && (
          <ReplaceAudio trackId={data.track.id} version={version} />
        )}
        {version.state === "ready" ? (
          <Player
            key={`${data.track.id}:${data.share || ""}:${data.preview}`}
            trackId={data.track.id}
            versionName={version.name}
            revision={version.revision}
            seekRequest={seekRequest}
            availableSources={data.versions
              .filter((v) => v.state === "ready")
              .map((v) => v.id + v.revision)
              .join(",")}
            title={data.track.title}
            artist={data.track.artist}
            artwork={artwork}
            playbackRef={playbackRef}
            repeat={repeat}
            onRepeatChange={onRepeatChange}
            onComment={(selection) =>
              onComment({ versionId: version.id, ...selection })
            }
            share={data.preview ? undefined : data.share}
            versionId={version.id}
            url={
              "/media/" +
              version.id +
              (data.share ? "?share=" + data.share : "") +
              (data.preview ? "&preview=1" : "")
            }
            peaks={version.peaks || []}
            duration={version.duration || 0}
            metadata={version.metadata}
          />
        ) : (
          <div className="audio-unavailable" role="status">
            <strong>
              {version.state === "missing"
                ? "Audio unavailable"
                : version.state === "failed"
                  ? "Audio could not be processed"
                  : "Processing audio…"}
            </strong>
            {version.state === "missing" && (
              <p>
                The audio for this version is currently unavailable. Please
                check back later.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="track-actions">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onComment({ versionId: version.id, start: null, end: null })
          }
        >
          {data.owner ? "Add internal comment" : "Add comment"}
        </button>
        {version.canDownload ? (
          <Download
            key={version.id + version.revision}
            versionId={version.id}
            versionName={version.name}
            share={data.share}
            owner={data.owner}
            wav={version.wavDownload}
            preview={data.preview}
          />
        ) : (
          <IconButton
            className="icon-action"
            icon="download"
            aria-disabled="true"
            label={
              version.state === "ready"
                ? "Downloads aren’t allowed for this version"
                : "Download unavailable: this version has no audio"
            }
          />
        )}
      </div>
    </section>
  );
}
