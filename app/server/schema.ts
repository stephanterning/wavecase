import {
  pgTable,
  uniqueIndex,
  index,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  bigint,
  bigserial,
  doublePrecision,
} from "drizzle-orm/pg-core";
const id = () => uuid("id").primaryKey().defaultRandom();
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const settings = pgTable("settings", {
  id: integer().primaryKey(),
  openRegistration: boolean().notNull().default(false),
});
export const users = pgTable("users", {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  admin: boolean().notNull().default(false),
  disabled: boolean().notNull().default(false),
  createdAt: created(),
});
export const passkeys = pgTable("passkeys", {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  publicKey: text().notNull(),
  counter: bigint({ mode: "number" }).notNull(),
  transports: jsonb().$type<string[]>().notNull().default([]),
});
export const sessions = pgTable("sessions", {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  expires: timestamp({ withTimezone: true }).notNull(),
});
export const challenges = pgTable("challenges", {
  id: text().primaryKey(),
  value: text().notNull(),
  payload: jsonb()
    .$type<{
      name?: string;
      email?: string;
      invitation?: string;
      open?: boolean;
      bootstrap?: boolean;
      targetId?: string;
      recovery?: string;
    }>()
    .notNull(),
  kind: text().notNull(),
  expires: timestamp({ withTimezone: true }).notNull(),
});
export const invitations = pgTable("invitations", {
  id: text().primaryKey(),
  expires: timestamp({ withTimezone: true }).notNull(),
  used: boolean().notNull().default(false),
});
export const tracks = pgTable("tracks", {
  id: id(),
  artistId: uuid().references(() => artists.id, { onDelete: "set null" }),
  ownerId: uuid()
    .notNull()
    .references(() => users.id),
  cover: text(),
  title: text().notNull(),
  artist: text().notNull().default(""),
  description: text().notNull().default(""),
  createdAt: created(),
});
export const versions = pgTable("versions", {
  position: bigserial({ mode: "number" }).notNull().unique(),
  id: id(),
  trackId: uuid()
    .notNull()
    .references(() => tracks.id),
  name: text().notNull(),
  description: text().notNull().default(""),
  status: text().notNull().default("work in progress"),
  download: boolean().notNull().default(false),
  state: text().notNull().default("processing"),
  pendingOriginal: text(),
  pendingFilename: text(),
  original: text(),
  playback: text(),
  filename: text().notNull(),
  duration: doublePrecision(),
  metadata: jsonb().$type<Record<string, unknown>>(),
  peaks: jsonb().$type<number[]>(),
  error: text(),
  createdAt: created(),
});
export const links = pgTable("links", {
  id: text().primaryKey(),
  trackId: uuid()
    .notNull()
    .references(() => tracks.id),
  label: text().notNull(),
  active: boolean().notNull().default(true),
  download: boolean().notNull().default(false),
  fromOrder: bigint({ mode: "number" }),
  createdAt: created(),
});
export const comments = pgTable("comments", {
  id: id(),
  versionId: uuid()
    .notNull()
    .references(() => versions.id),
  linkId: text()
    .notNull()
    .references(() => links.id),
  threadId: uuid(),
  name: text().notNull(),
  secretHash: text(),
  owner: boolean().notNull().default(false),
  body: text(),
  start: doublePrecision(),
  end: doublePrecision(),
  createdAt: created(),
});
export const events = pgTable("events", {
  id: id(),
  versionId: uuid().references(() => versions.id),
  linkId: text()
    .notNull()
    .references(() => links.id),
  browser: text().notNull(),
  session: text().notNull(),
  name: text(),
  kind: text().notNull(),
  position: doublePrecision(),
  end: doublePrecision(),
  context: jsonb(),
  createdAt: created(),
});

export const recoveries = pgTable("recoveries", {
  id: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  expires: timestamp({ withTimezone: true }).notNull(),
});
export const reuploadRequests = pgTable("reupload_requests", {
  linkId: text()
    .primaryKey()
    .references(() => links.id),
  trackId: uuid()
    .notNull()
    .references(() => tracks.id),
  name: text(),
  createdAt: created(),
});

export const artists = pgTable("artists", {
  id: id(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id),
  name: text().notNull(),
  slug: text().notNull().unique(),
  bio: text().notNull().default(""),
  image: text(),
  links: jsonb()
    .$type<{ label: string; url: string }[]>()
    .notNull()
    .default([]),
  createdAt: created(),
});
export const releases = pgTable(
  "releases",
  {
    id: id(),
    artistId: uuid()
      .notNull()
      .references(() => artists.id),
    title: text().notNull(),
    slug: text().notNull(),
    kind: text().notNull().default("single"),
    description: text().notNull().default(""),
    cover: text(),
    metadata: jsonb()
      .$type<import("../domain/releases").ReleaseMetadata>()
      .notNull()
      .default({}),
    links: jsonb()
      .$type<{ label: string; url: string }[]>()
      .notNull()
      .default([]),
    published: boolean().notNull().default(false),
    audioEnabled: boolean().notNull().default(false),
    createdAt: created(),
  },
  (table) => [
    uniqueIndex("release_artist_slug").on(table.artistId, table.slug),
  ],
);
export const releaseTracks = pgTable("release_tracks", {
  id: id(),
  releaseId: uuid()
    .notNull()
    .references(() => releases.id),
  title: text().notNull(),
  position: integer().notNull(),
  metadata: jsonb()
    .$type<import("../domain/releases").TrackMetadata>()
    .notNull()
    .default({}),
  original: text(),
  playback: text(),
  audioMeasurements: jsonb().$type<{
    lufs: number | null;
    peak: number | null;
    truePeak: number | null;
  }>(),
  pendingOriginal: text(),
  error: text(),
  duration: doublePrecision(),
  sampleRate: integer(),
  bitDepth: integer(),
});
export const releaseEvents = pgTable(
  "release_events",
  {
    id: id(),
    releaseId: uuid()
      .notNull()
      .references(() => releases.id),
    kind: text().notNull(),
    trackId: uuid().references(() => releaseTracks.id),
    email: text(),
    detail: text(),
    createdAt: created(),
  },
  (table) => [index("release_events_release").on(table.releaseId)],
);
