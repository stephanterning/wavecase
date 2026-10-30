import { limitedBody } from "../server/request";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { and, asc, eq, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { comments, versions, events } from "../server/schema";
import { versionAccess } from "../server/access";
import { hash, sameOrigin, viewer } from "../server/security";
const input = z.object({
  browser: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(5000),
  secret: z.string().min(32).max(100),
  threadId: z.uuid().optional(),
  start: z.number().nonnegative().nullable(),
  end: z.number().nonnegative().nullable(),
});
export async function loader({ request, params }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const access = await versionAccess(
    request,
    params.id!,
    query.get("share") || undefined,
  );
  const rows = await db
    .select({
      secretHash: comments.secretHash,
      id: comments.id,
      versionId: comments.versionId,
      linkId: comments.linkId,
      threadId: comments.threadId,
      name: comments.name,
      body: comments.body,
      start: comments.start,
      end: comments.end,
      owner: comments.owner,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.versionId, params.id!),
        access.owner ? undefined : eq(comments.linkId, access.link!.id),
      ),
    )
    .orderBy(asc(comments.createdAt));
  const secret = request.headers.get("X-Comment-Secret");
  return Response.json(
    rows.map(({ secretHash, ...row }) => ({
      ...row,
      canDelete:
        access.owner ||
        (!!secret && secret.length >= 32 && hash(secret) === secretHash),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const query = new URL(request.url).searchParams;
  const access = await versionAccess(
    request,
    params.id!,
    query.get("share") || undefined,
  );
  const body = await (await limitedBody(request, 65536)).json();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from versions where id=${params.id!} for update`,
    );
    const current = await tx.query.versions.findFirst({
      where: eq(versions.id, params.id!),
    });
    if (current) access.version = current;
    if (body.delete) {
      const comment = await tx.query.comments.findFirst({
        where: and(
          eq(comments.id, z.uuid().parse(body.delete)),
          eq(comments.versionId, params.id!),
        ),
      });
      if (
        !comment ||
        (!access.owner &&
          (comment.linkId !== access.link?.id ||
            comment.secretHash !==
              hash(z.string().min(32).max(100).parse(body.secret))))
      )
        throw new Response("Forbidden", { status: 403 });
      {
        const later = await tx.query.comments.findFirst({
          where: and(
            eq(comments.threadId, comment.threadId || comment.id),
            sql`${comments.createdAt} > (select created_at from comments where id=${comment.id})`,
          ),
        });
        if (later)
          await tx
            .update(comments)
            .set({ body: null, secretHash: null })
            .where(eq(comments.id, comment.id));
        else {
          await tx.delete(comments).where(eq(comments.id, comment.id));
          if (comment.threadId) {
            const remaining = await tx.query.comments.findFirst({
              where: eq(comments.threadId, comment.threadId),
            });
            if (!remaining)
              await tx
                .delete(comments)
                .where(
                  and(eq(comments.id, comment.threadId), isNull(comments.body)),
                );
          }
        }
      }
      return { ok: true };
    }
    const data = input.parse(body);
    const parent = data.threadId
      ? await tx.query.comments.findFirst({
          where: and(
            eq(comments.id, data.threadId),
            eq(comments.versionId, params.id!),
          ),
        })
      : null;
    if (
      data.threadId &&
      (!parent ||
        parent.threadId ||
        (!access.owner && parent.linkId !== access.link?.id))
    )
      throw new Response("Thread unavailable", { status: 404 });
    if (access.owner && !parent)
      throw new Response("Choose a thread to reply to", { status: 400 });
    if (
      (data.start !== null &&
        (!access.version.duration || data.start > access.version.duration)) ||
      (data.end !== null &&
        (data.start === null ||
          data.end < data.start ||
          data.end > access.version.duration!))
    )
      throw new Response("Invalid time range", { status: 400 });
    const user = access.owner ? await viewer(request) : null;
    if (!access.owner && data.browser)
      await tx
        .update(events)
        .set({ name: data.name })
        .where(
          and(
            eq(events.browser, data.browser),
            eq(events.linkId, access.link!.id),
          ),
        );
    await tx.insert(comments).values({
      versionId: params.id!,
      linkId: parent?.linkId || access.link!.id,
      threadId: parent?.id,
      name: user?.name || data.name,
      body: data.body,
      secretHash: access.owner ? null : hash(data.secret),
      owner: access.owner,
      start: parent ? null : data.start,
      end: parent ? null : data.end,
    });
    return { ok: true };
  });
}
