export function Icon({
  name,
}: {
  name:
    | "play"
    | "pause"
    | "repeat"
    | "download"
    | "close"
    | "plus"
    | "trash"
    | "edit"
    | "link"
    | "copy"
    | "eye"
    | "heart"
    | "upload"
    | "dashboard"
    | "waveform"
    | "disc"
    | "artists"
    | "image-plus"
    | "check-circle";
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "dashboard" && (
        <path d="M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z" />
      )}
      {name === "waveform" && (
        <path d="M2 10v4M6 6v12M10 3v18M14 7v10M18 5v14M22 10v4" />
      )}
      {name === "disc" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="2" />
          <path d="M6 9a7 7 0 0 1 2-3M18 15a7 7 0 0 1-2 3" />
        </>
      )}
      {name === "artists" && (
        <>
          <circle cx="10" cy="8" r="5" />
          <path d="M2 21v-2a8 8 0 0 1 16 0v2M17 3a5 5 0 0 1 0 10M22 21v-2a8 8 0 0 0-4-7" />
        </>
      )}
      {name === "image-plus" && (
        <>
          <path d="M14 3H3v18h18V10M16 4h6M19 1v6M3 17l6-6 5 5 3-3 4 4" />
          <circle cx="8" cy="7" r="1.5" />
        </>
      )}
      {name === "check-circle" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
      {name === "play" && (
        <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
      )}
      {name === "pause" && (
        <>
          <path d="M8 5v14M16 5v14" strokeWidth="4" />
        </>
      )}
      {name === "repeat" && (
        <>
          <path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3" />
        </>
      )}
      {name === "download" && (
        <>
          <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" />
        </>
      )}
      {name === "upload" && <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "trash" && (
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      )}
      {name === "edit" && <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z" />}
      {name === "link" && (
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
      )}
      {name === "copy" && <path d="M9 9h12v12H9ZM15 5V3H3v12h2" />}
      {name === "eye" && (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {name === "heart" && (
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      )}
    </svg>
  );
}
