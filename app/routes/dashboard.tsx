import { pendingArtistInvitations } from "../server/artist-members";
import {
  Form,
  useSubmit,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "../server/security";
import { dashboard } from "../server/dashboard";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    name: user.name,
    invitations: (await pendingArtistInvitations(user.id)).length,
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
const date = (value: Date | string) =>
  new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC";
export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const submit = useSubmit();
  return (
    <>
      <p className="eyebrow">DASHBOARD</p>
      {!!d.invitations && (
        <p role="status">
          <a href="/artist-profiles">
            You have {d.invitations} pending artist invitation(s). Review
            invitations
          </a>
        </p>
      )}
      <div className="dashboard-heading">
        <h1>Welcome back, {d.name}.</h1>
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
        Your library now: {d.inventory.demos} demos · {d.inventory.published}{" "}
        published releases · {d.inventory.drafts} release drafts ·{" "}
        {d.inventory.artists} artists
      </p>

      <section className="panel">
        <h2>Quick actions</h2>
        <div className="quick-actions">
          <a href="/library?create=1">Add new track →</a>
          <a href="/releases?create=1">Add release →</a>
          <a href="/artist-profiles?create=1">Add artist →</a>
        </div>
      </section>
      <div className="dashboard-columns">
        <section className="panel">
          <h2>Latest feedback</h2>
          <p className="muted">Received during the selected period.</p>
          <ul className="overview-list">
            {d.feedback.map((f) => (
              <li key={f.id}>
                <a
                  href={`/tracks/${f.trackId}?version=${f.versionId}#feedback`}
                >
                  {f.title} · {f.version}
                </a>
                <span>
                  {f.name} · {date(f.createdAt)}
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
                <a href={r.href}>{r.title}</a>
                <span className="muted">
                  {r.kind} · {date(r.createdAt)}
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
