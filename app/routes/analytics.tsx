import { heatmap } from "../domain/listening";
import {
  activityTimeline,
  playedIntervals,
  summarizeActivity,
  uniqueCoverage,
} from "../domain/activity";
import { Form, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { eq, desc } from "drizzle-orm";
import { useState } from "react";
import { db } from "../server/db";
import { events, links, versions } from "../server/schema";
import { trackAccess } from "../server/access";
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
  value
    ? new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })
    : "No activity";
const seconds = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
function Summary({ rows }: { rows: Row[] }) {
  const stats = summarizeActivity(rows.map((r) => r.event));
  return (
    <>
      <p>
        {stats.visits} visits · {stats.plays} plays · {stats.browsers} browsers
        · {seconds(stats.listening)} listened · {stats.downloads} downloads
        started
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
            title={`${seconds((i * duration) / bins.length)}: ${value.toFixed(1)} equivalent listens`}
            style={{ opacity: 0.12 + (0.88 * value) / max }}
          />
        ))}
      </div>
      <div className="timeline-scale">
        <span>0:00</span>
        <span>{seconds(duration)}</span>
      </div>
    </>
  );
}
function eventDescription(event: Row["event"]) {
  const start = seconds(event.position || 0),
    end = seconds(event.end || 0);
  switch (event.kind) {
    case "interval":
      return `Played ${start} → ${end}`;
    case "seek":
      return `${(event.end || 0) >= (event.position || 0) ? "Skipped forward" : "Sought back"} ${start} → ${end}`;
    case "play":
      return `Playback started at ${start}`;
    case "pause":
      return `Paused at ${start}`;
    case "ended":
      return `Finished at ${start}`;
    case "download-started":
      return "Original download started";
    default:
      return "Share page visited";
  }
}
export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const [link, setLink] = useState("");
  const [browser, setBrowser] = useState("");
  const linkRows = data.events.filter((r) => !link || r.event.linkId === link);
  const browserIds = [...new Set(linkRows.map((r) => r.event.browser))];
  const rows = linkRows.filter((r) => !browser || r.event.browser === browser);
  const sessions = [
    ...new Set(
      rows.map((r) =>
        JSON.stringify([r.event.linkId, r.event.browser, r.event.session]),
      ),
    ),
  ];
  const downloads = rows.filter((r) => r.event.kind === "download-started");
  return (
    <>
      <a href={"/tracks/" + data.track.id}>← {data.track.title}</a>
      <h1>Listening activity</h1>
      <p className="muted">
        Times shown in UTC. Names and browser identifiers do not verify people
        or physical devices. Location is approximate.
      </p>
      <div className="grid">
        <label>
          Share link
          <select
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setBrowser("");
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
          <select value={browser} onChange={(e) => setBrowser(e.target.value)}>
            <option value="">All browsers</option>
            {browserIds.map((id) => (
              <option key={id} value={id}>
                {linkRows.find((r) => r.event.browser === id && r.event.name)
                  ?.event.name || "Unnamed listener"}{" "}
                · {id.slice(0, 8)}
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
              <Summary rows={rows.filter((r) => r.event.linkId === l.id)} />
            </section>
          ))}
      </details>
      <details className="panel">
        <summary>Activity by listener browser</summary>
        {browserIds
          .filter((id) => !browser || browser === id)
          .map((id) => {
            const activity = rows.filter((r) => r.event.browser === id);
            return (
              <section key={id}>
                <h2>
                  {activity.find((r) => r.event.name)?.event.name ||
                    "Unnamed listener"}
                </h2>
                <p className="muted">Browser ID: {id}</p>
                <Summary rows={activity} />
                <Context value={activity[0]?.event.context} />
              </section>
            );
          })}
      </details>
      <h2>Version coverage</h2>
      <p className="muted">
        Brighter passages received more listening. Dark passages have no
        observed listening. Replays increase listening time, but not unique
        coverage.
      </p>
      {data.versions.map((version) => {
        const activity = rows.filter((r) => r.event.versionId === version.id);
        const ev = activity.map((r) => r.event);
        return (
          <section className="panel" key={version.id}>
            <h2>{version.name}</h2>
            <p>
              {seconds(summarizeActivity(ev).listening)} listened ·{" "}
              {seconds(uniqueCoverage(ev))} of {seconds(version.duration || 0)}{" "}
              reached
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
      {sessions.map((key) => {
        const [linkId, browserId, session] = JSON.parse(key) as string[];
        const activity = rows.filter(
          (r) =>
            r.event.session === session &&
            r.event.browser === browserId &&
            r.event.linkId === linkId,
        );
        const segments = activityTimeline(activity.map((r) => r.event));
        return (
          <details className="panel" key={key}>
            <summary>
              {activity[0].label} ·{" "}
              {activity.find((r) => r.event.name)?.event.name ||
                "Unnamed listener"}{" "}
              · {browserId.slice(0, 8)} ·{" "}
              {time(activity.at(-1)!.event.createdAt)}
            </summary>
            <Summary rows={activity} />
            <Context value={activity[0].event.context} />
            <p className="muted">
              Timeline in event order. Green: listened. Orange: skipped forward.
              Purple: sought back. Replayed passages appear again.
            </p>
            <ol className="session-timeline">
              {segments.map((event) => {
                const version = data.versions.find(
                  (v) => v.id === event.versionId,
                );
                const duration = version?.duration || 1;
                const start = event.position || 0,
                  end = event.end ?? start;
                const left = Math.min(
                  100,
                  (Math.min(start, end) / duration) * 100,
                );
                const width = Math.max(
                  0.5,
                  Math.min(
                    100 - left,
                    (Math.abs(end - start) / duration) * 100,
                  ),
                );
                return (
                  <li key={event.id}>
                    <div>
                      <span className="muted">{time(event.createdAt)}</span> ·{" "}
                      {version?.name || "Share page"} ·{" "}
                      {eventDescription(event)}
                    </div>
                    {version && (
                      <div
                        className="session-track"
                        aria-label={eventDescription(event)}
                      >
                        <span
                          className={
                            event.kind === "interval"
                              ? "played"
                              : event.kind === "seek"
                                ? end >= start
                                  ? "skipped"
                                  : "backward"
                                : "marker"
                          }
                          style={{ left: left + "%", width: width + "%" }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        );
      })}
      {!rows.length && (
        <p className="muted">No activity for this selection yet.</p>
      )}
      <h2>Original downloads</h2>
      <p className="muted">
        These are initiated transfers, not confirmation that the entire file was
        received.
      </p>
      {downloads.map((r) => (
        <details className="panel" key={r.event.id}>
          <summary>
            {r.label} · {r.version} · {r.event.name || "Unnamed listener"} ·{" "}
            {time(r.event.createdAt)}
          </summary>
          <p>Browser ID: {r.event.browser}</p>
          <Context value={r.event.context} />
        </details>
      ))}
      {!downloads.length && (
        <p className="muted">No downloads for this selection.</p>
      )}
      <Form
        method="post"
        action={"/tracks/" + data.track.id + "/manage"}
        onSubmit={(e) => {
          if (
            !confirm(
              "Permanently delete all listening statistics for this track, including other filter selections?",
            )
          )
            e.preventDefault();
        }}
      >
        <button name="intent" value="clear-analytics" className="secondary">
          Delete all track statistics
        </button>
      </Form>
    </>
  );
}
