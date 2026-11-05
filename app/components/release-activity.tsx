import { Link } from "react-router";
import type { loader } from "../routes/release-edit";
import { formatCount, formatDateTime } from "../domain/format";

type Data = Awaited<ReturnType<typeof loader>>;

const activityKinds = ["visit", "play", "click"];

export function ReleaseActivity({
  stats,
  downloads,
  tracks,
  page,
}: Pick<Data, "stats" | "downloads" | "tracks" | "page">) {
  return (
    <section className="panel">
      <h2 id="release-activity" tabIndex={-1}>
        Release activity
      </h2>
      {stats.length ? (
        <ul>
          {stats
            .toSorted(
              (a, b) =>
                activityKinds.indexOf(a.kind) - activityKinds.indexOf(b.kind),
            )
            .map((s, i) => (
              <li key={i}>
                {s.kind === "visit"
                  ? formatCount(s.count, "page visit")
                  : s.kind === "play"
                    ? `${formatCount(s.count, "play")} · ${tracks.find((t) => t.id === s.trackId)?.title || "Removed track"}`
                    : `${formatCount(s.count, "link click")} · ${s.detail}`}
              </li>
            ))}
        </ul>
      ) : (
        <p>No visits, plays or link clicks yet.</p>
      )}
      <h3>Download requests</h3>
      <p>
        Addresses are self-reported. A request does not confirm transfer
        completion.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Email</th>
              <th>Package contents</th>
            </tr>
          </thead>
          <tbody>
            {downloads.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.createdAt)}</td>
                <td>{e.email}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page > 0 && (
        <Link to={`?view=activity&page=${page - 1}`}>Newer requests</Link>
      )}
      {downloads.length === 50 && (
        <Link to={`?view=activity&page=${page + 1}`}>Older requests</Link>
      )}
    </section>
  );
}
