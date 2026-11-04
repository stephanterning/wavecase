import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  artists,
  artistMembers,
  artistInvitations,
  tracks,
  versions,
  releases,
  links,
  comments,
  sessions,
} from "../app/server/schema";
import {
  manageArtistMembers,
  acceptArtistInvitation,
  artistInvitation,
} from "../app/server/artist-members";
import { trackAccess, versionAccess } from "../app/server/access";
import { releaseAccess } from "../app/server/releases";
import { dashboard } from "../app/server/dashboard";
import { artistChoices } from "../app/server/track-artist";
import { hash, origin } from "../app/server/security";
import { loader as feedback, action as comment } from "../app/routes/feedback";
import { deleteDemo, deleteShareLink } from "../app/server/delete-demo";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { action: manage } = await import("../app/routes/manage");
const { action: createDemo, loader: library } =
  await import("../app/routes/library");
const { action: createRelease, loader: releaseList } =
  await import("../app/routes/releases");
after(() => pool.end());
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const args = (request: Request, id = "") => ({
  request,
  params: { id },
  url: new URL(request.url),
  pattern: "/",
  context: new RouterContextProvider(),
});

async function createInvitation(owner: string, artist: string) {
  const id = await manageArtistMembers(
    owner,
    artist,
    form({ intent: "create-invitation", label: "For collaborator" }),
  );
  assert.ok(id);
  return id;
}

test(
  "shared artists: invitations, full content access, internal privacy, moves and revocation",
  { skip: !enabled },
  async () => {
    const stephan = randomUUID(),
      hugo = randomUUID(),
      stranger = randomUUID();
    const hust = randomUUID(),
      hgo = randomUUID(),
      personal = randomUUID();
    const demo = randomUUID(),
      version = randomUUID(),
      release = randomUUID(),
      link = randomUUID();
    const tokens = new Map<string, string>();
    for (const [id, name] of [
      [stephan, "Stephan"],
      [hugo, "Hugo"],
      [stranger, "Other administrator"],
    ]) {
      await db.insert(users).values({
        id,
        name,
        email: `${id}@test.invalid`,
        admin: id === stranger,
      });
      const token = randomUUID();
      tokens.set(id, token);
      await db.insert(sessions).values({
        id: hash(token),
        userId: id,
        expires: new Date(Date.now() + 3600000),
      });
    }
    const request = (user: string, values?: Record<string, string>) =>
      new Request(origin, {
        headers: {
          cookie: `session=${tokens.get(user)}`,
          ...(values ? { origin } : {}),
        },
        ...(values ? { method: "POST", body: form(values) } : {}),
      });
    await db.insert(artists).values([
      { id: hust, ownerId: stephan, name: "HUST", slug: hust },
      { id: hgo, ownerId: hugo, name: "hgo", slug: hgo },
      { id: personal, ownerId: stephan, name: "Zam Pels", slug: personal },
    ]);
    await db.insert(tracks).values({
      id: demo,
      ownerId: stephan,
      artistId: hust,
      title: "Shared demo",
    });
    await db.insert(versions).values({
      id: version,
      trackId: demo,
      name: "v1",
      filename: "demo.wav",
      state: "ready",
      duration: 30,
    });
    await db
      .insert(releases)
      .values({ id: release, artistId: hust, title: "Draft", slug: release });
    await db
      .insert(links)
      .values({ id: link, trackId: demo, label: "Listener" });
    await assert.rejects(trackAccess(request(hugo), demo));
    const invitation = await createInvitation(stephan, hust);
    await assert.rejects(trackAccess(request(hugo), demo));
    await assert.rejects(acceptArtistInvitation(stephan, invitation));
    await acceptArtistInvitation(hugo, invitation);
    await assert.rejects(acceptArtistInvitation(hugo, invitation));
    assert.equal((await versionAccess(request(hugo), version)).owner, true);
    assert.equal(
      (await releaseAccess(request(hugo), release, true)).owner,
      true,
    );
    await assert.rejects(trackAccess(request(stranger), demo));
    assert.equal(
      (await artistChoices(hugo)).some((a) => a.id === personal),
      false,
    );
    assert.equal(
      (await library(args(request(hugo)))).tracks.some((t) => t.id === demo),
      true,
    );
    assert.equal(
      (await releaseList(args(request(hugo)))).releases.some(
        (r) => r.release.id === release,
      ),
      true,
    );
    assert.equal((await dashboard(hugo, "all")).inventory.demos, 1);
    const created = await createDemo(
      args(request(hugo, { title: "Hugo demo", artistId: hust })),
    );
    assert.ok(created instanceof Response);
    const hugoDemo = created.headers.get("location")!.split("/").at(-1)!;
    assert.equal((await trackAccess(request(stephan), hugoDemo)).owner, true);
    const createdRelease = await createRelease(
      args(
        request(hugo, {
          intent: "release",
          artist: hust,
          name: "Hugo release",
          slug: randomUUID(),
          kind: "single",
        }),
      ),
    );
    assert.ok(createdRelease instanceof Response);
    assert.equal(
      (
        await releaseAccess(
          request(stephan),
          createdRelease.headers.get("location")!.split("/").at(-1)!,
          true,
        )
      ).owner,
      true,
    );

    const post = (user: string | null, body: unknown, share = "") =>
      comment(
        args(
          new Request(origin + (share ? `?share=${share}` : ""), {
            method: "POST",
            headers: {
              origin,
              "Content-Type": "application/json",
              ...(user ? { cookie: `session=${tokens.get(user)}` } : {}),
            },
            body: JSON.stringify(body),
          }),
          version,
        ),
      );
    const payload = {
      name: "Spoofed name",
      body: "Internal discussion",
      secret: "a".repeat(64),
      start: 2,
      end: 5,
    };
    await post(hugo, payload);
    const internal = (
      await db.select().from(comments).where(eq(comments.versionId, version))
    )[0];
    assert.equal(internal.linkId, null);
    assert.equal(internal.authorId, hugo);
    assert.equal(internal.name, "Hugo");
    await post(stephan, {
      ...payload,
      body: "Internal reply",
      threadId: internal.id,
      start: null,
      end: null,
    });
    const listenerRequest = new Request(origin + `?share=${link}`);
    assert.deepEqual(
      await (await feedback(args(listenerRequest, version))).json(),
      [],
    );
    await assert.rejects(
      post(null, { ...payload, threadId: internal.id }, link),
    );
    await assert.rejects(
      post(null, { delete: internal.id, secret: "a".repeat(64) }, link),
    );
    await post(null, { ...payload, body: "External question" }, link);
    const external = (
      await db.select().from(comments).where(eq(comments.linkId, link))
    )[0];
    await post(hugo, {
      ...payload,
      body: "External answer",
      threadId: external.id,
      start: null,
      end: null,
    });
    assert.equal(
      (await (await feedback(args(listenerRequest, version))).json()).length,
      2,
    );
    assert.equal(
      (await (await feedback(args(request(stephan), version))).json()).length,
      4,
    );

    await assert.rejects(
      manageArtistMembers(
        hugo,
        hust,
        form({ intent: "remove-member", member: randomUUID() }),
      ),
    );
    await assert.rejects(
      manage(
        args(
          request(hugo, { intent: "metadata", field: "artist", artistId: hgo }),
          demo,
        ),
      ),
    );
    await manage(
      args(
        request(hugo, {
          intent: "metadata",
          field: "artist",
          artistId: hgo,
          confirmArtistMove: "yes",
        }),
        demo,
      ),
    );
    await assert.rejects(trackAccess(request(stephan), demo));
    assert.equal((await trackAccess(request(hugo), demo)).owner, true);
    assert.equal(
      (await versionAccess(new Request(origin), version, link)).owner,
      false,
    );
    assert.equal(
      (await (await feedback(args(request(hugo), version))).json()).length,
      4,
    );
    await manage(
      args(
        request(hugo, {
          intent: "metadata",
          field: "artist",
          artistId: hust,
          confirmArtistMove: "yes",
        }),
        demo,
      ),
    );
    await manage(
      args(
        request(stephan, {
          intent: "metadata",
          field: "artist",
          artist: "",
          confirmArtistMove: "yes",
        }),
        demo,
      ),
    );
    await assert.rejects(trackAccess(request(hugo), demo));
    assert.equal((await trackAccess(request(stephan), demo)).owner, true);
    await deleteShareLink(demo, link);
    assert.equal(
      (await (await feedback(args(request(stephan), version))).json()).length,
      2,
    );
    await deleteDemo(demo, stephan, "Shared demo");
    assert.equal(
      (await db.select().from(comments).where(eq(comments.versionId, version)))
        .length,
      0,
    );

    await manageArtistMembers(hugo, hust, form({ intent: "leave-artist" }));
    await assert.rejects(trackAccess(request(hugo), hugoDemo)); // Original uploader loses access too.
    assert.equal((await trackAccess(request(stephan), hugoDemo)).owner, true);
    await assert.rejects(releaseAccess(request(hugo), release, true));
    const expired = await createInvitation(stephan, hust);
    await db
      .update(artistInvitations)
      .set({ expires: new Date(0) })
      .where(eq(artistInvitations.id, expired));
    await assert.rejects(acceptArtistInvitation(hugo, expired));
    const revoked = await createInvitation(stephan, hust);
    await manageArtistMembers(
      stephan,
      hust,
      form({ intent: "revoke-invitation", invitation: revoked }),
    );
    await assert.rejects(acceptArtistInvitation(hugo, revoked));
    await acceptArtistInvitation(hugo, await createInvitation(stephan, hust));
    assert.equal((await trackAccess(request(hugo), hugoDemo)).owner, true);
    const member = await db.query.artistMembers.findFirst({
      where: eq(artistMembers.userId, hugo),
    });
    await manageArtistMembers(
      stephan,
      hust,
      form({ intent: "remove-member", member: member!.id }),
    );
    await assert.rejects(trackAccess(request(hugo), hugoDemo));
    await assert.rejects(releaseAccess(request(hugo), release, true));
    await assert.rejects(
      manageArtistMembers(stephan, hust, form({ intent: "leave-artist" })),
    );
  },
);

test(
  "artist invitation links return through login and confirm the account before single-use acceptance",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      artist = randomUUID();
    const firstToken = randomUUID(),
      secondToken = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Stephan", email: `${owner}@test.invalid` },
      { id: first, name: "Hugo", email: `${first}@test.invalid` },
      { id: second, name: "Another account", email: `${second}@test.invalid` },
    ]);
    await db
      .insert(artists)
      .values({ id: artist, ownerId: owner, name: "HUST", slug: artist });
    for (const [id, token] of [
      [first, firstToken],
      [second, secondToken],
    ])
      await db
        .insert(sessions)
        .values({
          id: hash(token),
          userId: id,
          expires: new Date(Date.now() + 60000),
        });
    const id = await createInvitation(owner, artist);
    const path = `/artist-invitations/${id}`;
    const request = (token?: string, body?: FormData) =>
      new Request(origin + path, {
        headers: {
          ...(token ? { cookie: `session=${token}` } : {}),
          ...(body ? { origin } : {}),
        },
        ...(body ? { method: "POST", body } : {}),
      });
    const { loader: confirmation, action: accept } =
      await import("../app/routes/artist-invitation");
    const { loader: home } = await import("../app/routes/home");
    const inviteArgs = (req: Request) => ({
      ...args(req),
      params: { invitation: id },
    });
    const anonymous = await confirmation(inviteArgs(request()));
    assert.ok(anonymous instanceof Response);
    assert.equal(
      anonymous.headers.get("location"),
      "/?returnTo=" + encodeURIComponent(path),
    );
    const login = await home(
      args(new Request(origin + anonymous.headers.get("location"))),
    );
    assert.ok(!(login instanceof Response));
    assert.equal(login.returnTo, path);
    const afterLogin = await home(
      args(
        new Request(origin + anonymous.headers.get("location"), {
          headers: { cookie: `session=${firstToken}` },
        }),
      ),
    );
    assert.ok(afterLogin instanceof Response);
    assert.equal(afterLogin.headers.get("location"), path);
    const data = await confirmation(inviteArgs(request(firstToken)));
    assert.ok(!(data instanceof Response));
    assert.deepEqual(data.artist, { id: artist, name: "HUST" });
    assert.deepEqual(data.account, {
      id: first,
      name: "Hugo",
      email: `${first}@test.invalid`,
    });
    assert.equal(data.alreadyConnected, false);
    assert.equal(
      (
        await db
          .select()
          .from(artistMembers)
          .where(eq(artistMembers.artistId, artist))
      ).length,
      0,
    );
    // Switching sessions after rendering must require another confirmation.
    const stale = await accept(
      inviteArgs(request(secondToken, form({ account: first }))),
    );
    assert.ok(!(stale instanceof Response));
    assert.match(stale.error || "", /account changed/);
    await artistInvitation(id);
    const accepted = await accept(
      inviteArgs(request(firstToken, form({ account: first }))),
    );
    assert.ok(accepted instanceof Response);
    assert.equal(
      accepted.headers.get("location"),
      `/artist-profiles/${artist}`,
    );
    await assert.rejects(artistInvitation(id));
    const extra = await createInvitation(owner, artist);
    await assert.rejects(acceptArtistInvitation(first, extra));
    await artistInvitation(extra); // Existing co-owners leave the link usable for someone else.
    const race = await Promise.allSettled([
      acceptArtistInvitation(first, extra),
      acceptArtistInvitation(second, extra),
    ]);
    assert.equal(
      race.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const third = randomUUID();
    await db
      .insert(users)
      .values({ id: third, name: "Third", email: `${third}@test.invalid` });
    const concurrent = await createInvitation(owner, artist);
    const fourth = randomUUID();
    await db
      .insert(users)
      .values({ id: fourth, name: "Fourth", email: `${fourth}@test.invalid` });
    const results = await Promise.allSettled([
      acceptArtistInvitation(third, concurrent),
      acceptArtistInvitation(fourth, concurrent),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    await assert.rejects(
      manageArtistMembers(first, artist, form({ intent: "create-invitation" })),
    );
    const { action: logout } = await import("../app/routes/logout");
    const switchAccount = await logout(
      args(
        new Request(origin + "/logout", {
          method: "POST",
          headers: { origin, cookie: `session=${secondToken}` },
          body: new URLSearchParams({ returnTo: path }),
        }),
      ),
    );
    assert.equal(
      switchAccount.headers.get("location"),
      "/?returnTo=" + encodeURIComponent(path),
    );
    const { loginDestination } =
      await import("../app/domain/login-destination");
    for (const invalid of [
      "https://attacker.invalid",
      "//attacker.invalid",
      "/artist-invitations/../admin",
      "/dashboard?returnTo=https://attacker.invalid",
    ])
      assert.equal(loginDestination(invalid), "/dashboard");
  },
);
