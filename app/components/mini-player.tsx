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
      {(controls || track?.artwork) && (
        <div className="release-mini-transport">
          {track?.artwork && (
            <img src={track.artwork} alt="" width={52} height={52} />
          )}
          {controls && (
            <IconButton
              className="icon-action play-toggle"
              icon={playing ? "pause" : "play"}
              label={playing ? "Pause" : "Play"}
              tooltip={playing ? "Pause (Space)" : "Play (Space)"}
              aria-keyshortcuts="Space"
              onClick={onToggle}
            />
          )}
        </div>
      )}
      {track && (
        <div className="release-mini-description">
          <Link to={track.href}>{track.title}</Link>
          <span>{track.details}</span>
        </div>
      )}
      {seek}
      {controls && (
        <IconButton
          className="icon-action"
          icon="repeat"
          label={repeatLabel}
          tooltip={`${repeatLabel} ${repeating ? "on" : "off"}`}
          aria-pressed={repeating}
          onClick={() => onRepeat(!repeating)}
        />
      )}
      {children}
    </aside>
  );
}
