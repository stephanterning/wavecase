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
    | "link";
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
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "trash" && (
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      )}
      {name === "edit" && <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z" />}
      {name === "link" && (
        <path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />
      )}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    </svg>
  );
}
