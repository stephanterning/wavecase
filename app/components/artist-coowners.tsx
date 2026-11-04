import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { loader } from "../routes/artist-edit";
import { EditForm } from "./editing";
import { Icon } from "./icons";

type Data = Awaited<ReturnType<typeof loader>>;

function expiresIn(expires: number, now: number) {
  const remaining = expires - now;
  if (remaining > 86400000)
    return `Expires in ${Math.ceil(remaining / 86400000)} days`;
  if (remaining > 3600000)
    return `Expires in ${Math.ceil(remaining / 3600000)} hours`;
  if (remaining > 60000)
    return `Expires in ${Math.ceil(remaining / 60000)} minutes`;
  return "Expires in less than a minute";
}

export function ArtistCoOwners({ data }: { data: Data }) {
  const {
    artist,
    membershipManager,
    manager,
    members,
    invitations,
    invitationOrigin,
  } = data;
  const [now, setNow] = useState(data.loadedAt);
  const [copyNotice, setCopyNotice] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const revoke = useFetcher<{ saved?: boolean; error?: string }>();
  const pending = invitations.filter(
    (invitation) => new Date(invitation.expires).getTime() > now,
  );

  useEffect(() => {
    const deadlines = invitations
      .map((invitation) => new Date(invitation.expires).getTime())
      .filter((expires) => expires > now);
    if (!deadlines.length) return;
    // Refresh relative labels once a minute and remove rows at their deadline.
    const delay = Math.max(
      0,
      Math.min(60000, Math.min(...deadlines) - Date.now()),
    );
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [invitations, now]);

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  return (
    <section className="artist-coowners" aria-labelledby="coowners-heading">
      <div className="artist-section-heading">
        <h2 id="coowners-heading">Co-owners</h2>
        {membershipManager && (
          <EditForm
            label="Invite co-owner"
            trigger={<Icon name="plus" />}
            triggerLabel="Invite co-owner"
          >
            <input type="hidden" name="intent" value="create-invitation" />
            <p>
              Co-owners can upload, edit, publish and delete music, manage share
              links, and see discussions, feedback and statistics, including
              download email addresses.
            </p>
            <p>
              Create a single-use link and send it directly to the person you
              want to invite. Anyone with the link can accept it within seven
              days, after signing in and confirming their account.
            </p>
            <label>
              Invitation label (optional)
              <input name="label" maxLength={200} placeholder="e.g. Hugo" />
            </label>
            <button>Create invitation link</button>
          </EditForm>
        )}
      </div>
      <ul className="coowner-list">
        <li>
          <span className="coowner-name">
            {manager} <span className="muted">(manager)</span>
          </span>
        </li>
        {members.map((member) => (
          <li key={member.id}>
            <span className="coowner-name">{member.name}</span>
            {membershipManager && (
              <div className="coowner-actions">
                <EditForm
                  label={`Remove ${member.name} as co-owner`}
                  trigger={<Icon name="trash" />}
                  triggerLabel={`Remove ${member.name} as co-owner`}
                >
                  <input type="hidden" name="intent" value="remove-member" />
                  <input type="hidden" name="member" value={member.id} />
                  <p>
                    Remove <strong>{member.name}</strong> as co-owner of{" "}
                    <strong>{artist.name}</strong>?
                  </p>
                  <p>
                    They will lose private access to this artist's music,
                    discussions and statistics. Their uploads and comments will
                    stay with the artist.
                  </p>
                  <button className="danger">Remove co-owner</button>
                </EditForm>
              </div>
            )}
          </li>
        ))}
        {pending.map((invitation) => {
          const expiry = expiresIn(new Date(invitation.expires).getTime(), now);
          return (
            <li key={invitation.id}>
              <span
                className="coowner-name tooltip"
                data-tooltip={expiry}
                tabIndex={0}
                aria-describedby={`expiry-${invitation.id}`}
              >
                <span>
                  {invitation.label} <span className="muted">(pending)</span>
                </span>
                <span className="sr-only" id={`expiry-${invitation.id}`}>
                  {expiry}
                </span>
              </span>
              <div className="coowner-actions">
                <span
                  className="tooltip"
                  data-tooltip={
                    copyNotice?.id === invitation.id
                      ? copyNotice.message
                      : "Copy invitation link"
                  }
                >
                  <button
                    type="button"
                    className="artist-icon-action"
                    aria-label={`Copy invitation for ${invitation.label}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${invitationOrigin}/artist-invitations/${invitation.id}`,
                        );
                        setCopyNotice({ id: invitation.id, message: "Copied" });
                      } catch {
                        setCopyNotice({
                          id: invitation.id,
                          message: "Could not copy the link. Please try again.",
                        });
                      }
                    }}
                  >
                    <Icon name="copy" />
                  </button>
                </span>
                <revoke.Form method="post">
                  <input type="hidden" name="_inline" value="1" />
                  <input
                    type="hidden"
                    name="intent"
                    value="revoke-invitation"
                  />
                  <input
                    type="hidden"
                    name="invitation"
                    value={invitation.id}
                  />
                  <button
                    className="artist-icon-action"
                    aria-label={`Delete invitation for ${invitation.label}`}
                    title={`Delete invitation for ${invitation.label}`}
                    disabled={revoke.state !== "idle"}
                  >
                    <Icon name="trash" />
                  </button>
                </revoke.Form>
              </div>
            </li>
          );
        })}
      </ul>
      <span className="sr-only" role="status">
        {copyNotice?.message}
      </span>
      {revoke.data?.error && <p role="alert">{revoke.data.error}</p>}
      {!membershipManager && (
        <div className="coowners-leave">
          <EditForm label="Leave artist" trigger="Leave artist">
            <input type="hidden" name="intent" value="leave-artist" />
            <p>
              Leave <strong>{artist.name}</strong>? You will lose private access
              to its music and discussions. Your uploads and comments will stay
              with the artist.
            </p>
            <button className="danger">Leave artist</button>
          </EditForm>
        </div>
      )}
    </section>
  );
}
