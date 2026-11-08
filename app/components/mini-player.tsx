import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconButton } from "./icon-button";

export function MiniPlayer({
  label,
  className,
  track,
  controls = !!track,
  playing,
  onToggle,
  repeatLabel,
  repeating,
  onRepeat,
  seek,
  children,
}: {
  label: string;
  className?: string;
  track?: {
    title: string;
    details: string;
    href: string;
    /** Names the page the artwork link opens. */
    page: string;
    artwork?: string;
  };
  controls?: boolean;
  playing: boolean;
  onToggle: () => void;
  repeatLabel: string;
  repeating: boolean;
  onRepeat: (repeat: boolean) => void;
  seek?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <aside
      className={className ? `release-mini ${className}` : "release-mini"}
      aria-label={label}
    >
      {track && (
        <>
          <Link
            to={track.href}
            className="release-mini-artwork"
            aria-label={`Open ${track.page}`}
          >
            {track.artwork ? (
              <img src={track.artwork} alt="" width={52} height={52} />
            ) : (
              <span aria-hidden="true">♫</span>
            )}
          </Link>
          <div className="release-mini-description">
            <Link to={track.href}>{track.title}</Link>
            <span>{track.details}</span>
          </div>
        </>
      )}
      {seek}
      {controls && (
        <>
          <IconButton
            className="icon-action play-toggle"
            icon={playing ? "pause" : "play"}
            label={playing ? "Pause" : "Play"}
            tooltip={playing ? "Pause (Space)" : "Play (Space)"}
            aria-keyshortcuts="Space"
            onClick={onToggle}
          />
          <IconButton
            className="icon-action"
            icon="repeat"
            label={repeatLabel}
            tooltip={`${repeatLabel} ${repeating ? "on" : "off"}`}
            aria-pressed={repeating}
            onClick={() => onRepeat(!repeating)}
          />
        </>
      )}
      {children}
    </aside>
  );
}
