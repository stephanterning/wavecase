export function ReleaseCardContent({
  releaseId,
  title,
  kind,
  releaseDate,
  hasArtwork = true,
}: {
  releaseId: string;
  title: string;
  kind: string;
  releaseDate?: string | null;
  hasArtwork?: boolean;
}) {
  return (
    <>
      {hasArtwork ? (
        <img
          className="management-artwork"
          src={`/release-assets/${releaseId}/cover`}
          alt=""
        />
      ) : (
        <div className="management-artwork artwork-placeholder">
          Add artwork
        </div>
      )}
      <strong>{title}</strong>
      <span>
        {releaseDate && `${releaseDate.slice(0, 4)} · `}
        {kind}
      </span>
    </>
  );
}
