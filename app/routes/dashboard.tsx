import { Link } from "react-router";
import {
  Form,
  useSubmit,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "../server/security";
import { dashboard } from "../server/dashboard";
import { formatCount, formatDateTime } from "../domain/format";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    name: user.name,
    ...(await dashboard(
      user.id,
      new URL(request.url).searchParams.get("period"),
    )),
  };
}
function Cards({ values }: { values: [string, number][] }) {
  return (
    <div className="stat-grid">
      {values.map(([label, value]) => (
        <div className="stat-card" key={label}>
          <span className="muted">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const submit = useSubmit();
  return (
    <>
      <p className="eyebrow">Dashboard</p>
      <div className="dashboard-heading">
        <h1>Welcome, {d.name}.</h1>
        <Form method="get" className="period-form">
          <label>
            Activity period
            <select
              name="period"
              defaultValue={d.period}
              key={d.period}
              onChange={(event) => void submit(event.currentTarget.form)}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </Form>
      </div>
      <p className="muted">
        Your library now: {formatCount(d.inventory.demos, "demo")} ·{" "}
        {formatCount(d.inventory.published, "published release")} ·{" "}
        {formatCount(d.inventory.drafts, "release draft")} ·{" "}
        {formatCount(d.inventory.artists, "artist")}
      </p>

      <section className="panel">
        <h2>Quick actions</h2>
        <div className="quick-actions">
          <Link to="/library?create=1">Add new track →</Link>
          <Link to="/releases?create=1">Add release →</Link>
          <Link to="/artist-profiles?create=1">Add artist →</Link>
        </div>
      </section>
      <div className="dashboard-columns">
        <section className="panel">
          <h2>Latest feedback</h2>
          <p className="muted">Received during the selected period.</p>
          <ul className="overview-list">
            {d.feedback.map((f) => (
              <li key={f.id}>
                <Link
                  to={`/tracks/${f.trackId}?version=${f.versionId}#feedback`}
                >
                  {f.title} · {f.version}
                </Link>
                <span>
                  {f.name} · {formatDateTime(f.createdAt)}
                </span>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
          {!d.feedback.length && <p>No feedback in this period.</p>}
        </section>
        <section className="panel">
          <h2>Recently added</h2>
          <p className="muted">Latest additions across all time.</p>
          <ul className="overview-list">
            {d.recent.map((r) => (
              <li key={r.id}>
                <Link to={r.href}>{r.title}</Link>
                <span className="muted">
                  {r.kind} · {formatDateTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {!d.recent.length && (
            <p>Your library is quiet. Add something to get started.</p>
          )}
        </section>
      </div>
      <section className="dashboard-section">
        <h2>Work in progress</h2>
        <Cards
          values={[
            ["Plays", d.demo.plays],
            ["Feedback received", d.demo.feedback],
            ["Download requests", d.demo.downloads],
            ["Active links · now", d.demo.links],
          ]}
        />
        <p className="muted">
          Demo downloads exclude your own requests. Download requests do not
          confirm completed transfers.
        </p>
      </section>
      <section className="dashboard-section">
        <h2>Releases</h2>
        <Cards
          values={[
            ["Page visits", d.release.visits],
            ["Plays", d.release.plays],
            ["Download requests", d.release.downloads],
            ["External link clicks", d.release.clicks],
          ]}
        />
        <p className="muted">
          Release downloads include your own requests. Your visits, plays and
          external link clicks are excluded.
        </p>
      </section>
    </>
  );
}
