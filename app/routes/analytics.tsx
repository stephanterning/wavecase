import { Link } from "react-router";
import { heatmap } from "../domain/listening";
import {
  activityReport,
  playedIntervals,
  summarizeActivity,
  timelineBar,
  uniqueCoverage,
} from "../domain/activity";
import { Form, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { eq, desc } from "drizzle-orm";
import { db } from "../server/db";
import { events, links, versions } from "../server/schema";
import { trackAccess } from "../server/access";
import { ConfirmButton } from "../components/confirm-dialog";
import { formatClock, formatCount, formatDateTime } from "../domain/format";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const access = await trackAccess(request, params.id!);
  if (!access.owner) throw new Response("Forbidden", { status: 403 });
  return {
    track: access.track,
    links: await db.select().from(links).where(eq(links.trackId, params.id!)),
    versions: await db
      .select({
        id: versions.id,
        name: versions.name,
        duration: versions.duration,
      })
      .from(versions)
      .where(eq(versions.trackId, params.id!))
      .orderBy(desc(versions.position)),
    events: await db
      .select({
        event: events,
        label: links.label,
        version: versions.name,
        duration: versions.duration,
      })
      .from(events)
      .innerJoin(links, eq(events.linkId, links.id))
      .leftJoin(versions, eq(events.versionId, versions.id))
      .where(eq(links.trackId, params.id!))
      .orderBy(desc(events.createdAt)),
  };
}
type Row = Awaited<ReturnType<typeof loader>>["events"][number];
const time = (value: Date | string | null) =>
  value ? formatDateTime(value, { seconds: true }) : "No activity";
function Summary({ rows }: { rows: Row[] }) {
  const stats = summarizeActivity(rows.map((r) => r.event));
  return (
    <>
      <p>
        {formatCount(stats.visits, "visit")} ·{" "}
        {formatCount(stats.plays, "play")} ·{" "}
        {formatCount(stats.browsers, "browser")} ·{" "}
        {formatClock(stats.listening)} listened ·{" "}
        {formatCount(stats.downloads, "download")} started
      </p>
      <p className="muted">
        First: {time(stats.first)} · Latest: {time(stats.latest)}
      </p>
    </>
  );
}
function Context({ value }: { value: unknown }) {
  const context = (value || {}) as Record<string, unknown>;
  return (
    <dl className="visitor-context">
      {[
        ["IP address", "ip"],
        ["Country", "country"],
        ["Approximate city", "city"],
        ["Device", "device"],
        ["Model", "deviceModel"],
        ["Operating system", "os"],
        ["OS version", "osVersion"],
        ["Browser", "browser"],
        ["Browser version", "browserVersion"],
        ["Referring website", "referrer"],
      ].map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {typeof context[key] === "string"
              ? String(context[key])
              : "Unknown"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Heatmap({
  rows,
  duration,
  label,
}: {
  rows: Row[];
  duration: number;
  label: string;
}) {
  const intervals = playedIntervals(rows.map((r) => r.event));
  const bins = heatmap(intervals, duration);
  const max = Math.max(1, ...bins);
  return (
    <>
      <div className="heatmap" role="img" aria-label={label}>
        {bins.map((value, i) => (
          <span
            key={i}
            title={`${formatClock((i * duration) / bins.length)}: ${value.toFixed(1)} equivalent listens`}
            style={{ opacity: 0.12 + (0.88 * value) / max }}
          />
        ))}
      </div>
      <div className="timeline-scale">
        <span>0:00</span>
        <span>{formatClock(duration)}</span>
      </div>
    </>
  );
}
function eventDescription(event: Row["event"]) {
  const start = formatClock(event.position || 0),
    end = formatClock(event.end || 0);
  switch (event.kind) {
    case "interval":
      return start === end
        ? `Played under a second at ${start}`
        : `Played ${start} → ${end}`;
    case "seek":
      return `${(event.end || 0) >= (event.position || 0) ? "Skipped forward" : "Sought back"} ${start} → ${end}`;
    case "play":
      return `Playback started at ${start}`;
    case "version-changed":
      return `Changed version at ${start}`;
    case "pause":
      return `Paused at ${start}`;
    case "ended":
      return `Finished at ${start}`;
    case "download-started":
      return "Download started";
    default:
      return "Share page visited";
  }
}
export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const [search, setSearch] = useSearchParams();
  const report = activityReport(
    data.events,
    data.links.map((l) => l.id),
    { link: search.get("link") || "", browser: search.get("browser") || "" },
  );
  const { link, browser, rows } = report;
  return (
    <>
      <Link to={"/tracks/" + data.track.id}>← {data.track.title}</Link>
      <h1>Listening activity</h1>
      <details className="analytics-explanation">
        <summary>About these statistics</summary>
        <p className="muted">
          Plays count playback starts, including playback of another version and
          repeats after the end. Pausing and resuming or switching versions
          while paused does not add a play. Plays do not measure complete
          listens; listening time and version coverage show how much was heard.
        </p>
        <p className="muted">
          Times shown in UTC. Names and browser identifiers do not verify people
          or physical devices. Location is approximate.
        </p>
      </details>
      <div className="grid">
        <label>
          Share link
          <select
            value={link}
            onChange={(e) => {
              setSearch((params) => {
                if (e.target.value) params.set("link", e.target.value);
                else params.delete("link");
                params.delete("browser");
                return params;
              });
            }}
          >
            <option value="">All links</option>
            {data.links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Listener browser
          <select
            value={browser}
            onChange={(e) => {
              setSearch((params) => {
                if (e.target.value) params.set("browser", e.target.value);
                else params.delete("browser");
                return params;
              });
            }}
          >
            <option value="">All browsers</option>
            {report.listeners.map(({ id, name }) => (
              <option key={id} value={id}>
                {name || "Unnamed listener"} · {id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Summary rows={rows} />
      <details className="panel">
        <summary>Activity by share link</summary>
        {data.links
          .filter((l) => !link || l.id === link)
          .map((l) => (
            <section key={l.id}>
              <h2>
                {l.label}
                {!l.active && " · Disabled"}
              </h2>
              <Summary rows={report.byLink.get(l.id) ?? []} />
            </section>
          ))}
      </details>
      <details className="panel">
        <summary>Activity by listener browser</summary>
        {report.listeners
          .filter(({ id }) => !browser || browser === id)
          .map((listener) => (
            <section key={listener.id}>
              <h2>{listener.name || "Unnamed listener"}</h2>
              <p className="muted">Browser ID: {listener.id}</p>
              <Summary rows={listener.rows} />
              <Context value={listener.rows[0]?.event.context} />
            </section>
          ))}
      </details>
      <h2>Version coverage</h2>
      <p className="muted">
        Brighter passages received more listening. Dark passages have no
        observed listening. Replays increase listening time, but not unique
        coverage.
      </p>
      {data.versions.map((version) => {
        const activity = report.byVersion.get(version.id) ?? [];
        const ev = activity.map((r) => r.event);
        return (
          <section className="panel" key={version.id}>
            <h2>{version.name}</h2>
            <p>
              {formatClock(summarizeActivity(ev).listening)} listened ·{" "}
              {formatClock(uniqueCoverage(ev))} of{" "}
              {formatClock(version.duration || 0)} reached
            </p>
            <Heatmap
              rows={activity}
              duration={version.duration || 0}
              label={version.name + " listening heatmap"}
            />
          </section>
        );
      })}
      <h2>Listening sessions</h2>
      {report.sessions.map((session) => (
        <details className="panel" key={session.key}>
          <summary>
            {session.rows[0].label} · {session.name || "Unnamed listener"} ·{" "}
            {session.browser.slice(0, 8)} ·{" "}
            {time(session.rows.at(-1)!.event.createdAt)}
          </summary>
          <Summary rows={session.rows} />
          <Context value={session.rows[0].event.context} />
          <p className="muted">
            Timeline in event order. Green: listened. Orange: skipped forward.
            Purple: sought back. Replayed passages appear again.
          </p>
          <ol className="session-timeline">
            {session.timeline.map((event) => {
              const version = data.versions.find(
                (v) => v.id === event.versionId,
              );
              const bar = timelineBar(event, version?.duration || 1);
              return (
                <li key={event.id}>
                  <div>
                    <span className="muted">{time(event.createdAt)}</span> ·{" "}
                    {version?.name || "Share page"} · {eventDescription(event)}
                  </div>
                  {version && (
                    <div
                      className="session-track"
                      aria-label={eventDescription(event)}
                    >
                      <span
                        className={bar.kind}
                        style={{ left: bar.left + "%", width: bar.width + "%" }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      ))}
      {!rows.length && (
        <p className="muted">No activity for this selection yet.</p>
      )}
      <h2>Downloads</h2>
      <p className="muted">
        These are initiated transfers, not confirmation that the entire file was
        received.
      </p>
      {report.downloads.map((r) => (
        <details className="panel" key={r.event.id}>
          <summary>
            {r.label} · {r.version} · {r.event.name || "Unnamed listener"} ·{" "}
            {time(r.event.createdAt)}
          </summary>
          <p>
            Format:{" "}
            {String(
              (r.event.context as { format?: string } | null)?.format ||
                "original",
            ).toUpperCase()}
          </p>
          <p>
            Email:{" "}
            {String(
              (r.event.context as { email?: string } | null)?.email ||
                "Not recorded",
            )}
          </p>
          <p>Browser ID: {r.event.browser}</p>
          <Context value={r.event.context} />
        </details>
      ))}
      {!report.downloads.length && (
        <p className="muted">No downloads for this selection.</p>
      )}
      <Form method="post" action={"/tracks/" + data.track.id}>
        <ConfirmButton
          name="intent"
          value="clear-analytics"
          className="button-danger"
          confirmTitle={`Delete all statistics for “${data.track.title}”?`}
          confirmMessage={
            <p>
              This deletes every recorded visit, play and download for all
              versions and share links of this track, not only what the current
              filters show. Feedback is kept. This cannot be undone.
            </p>
          }
          confirmLabel="Delete all statistics"
        >
          Delete all track statistics
        </ConfirmButton>
      </Form>
    </>
  );
}
