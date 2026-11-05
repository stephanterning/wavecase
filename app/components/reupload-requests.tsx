import { Form } from "react-router";
import type { loader } from "../routes/track";
import { linkVersionScope } from "../domain/share-links";

type Data = Awaited<ReturnType<typeof loader>>;

export function ReuploadRequests({
  trackId,
  requests,
  links,
  versions,
}: Pick<Data, "requests" | "links" | "versions"> & { trackId: string }) {
  return requests.map((r) => {
    const link = links.find((l) => l.id === r.linkId);
    return (
      <div key={r.linkId} className="panel">
        Reupload requested via {link?.label}
        {link && <> · {linkVersionScope(link, versions)}</>}
        {r.name && <> · {r.name}</>}
        <Form method="post" action={"/tracks/" + trackId}>
          <input type="hidden" name="link" value={r.linkId} />
          <button name="intent" value="dismiss-request">
            Dismiss
          </button>
        </Form>
      </div>
    );
  });
}

export function RequestReupload({
  preview,
  requested,
}: {
  preview: boolean;
  requested?: boolean;
}) {
  return (
    <Form
      method="post"
      onSubmit={(event) => {
        if (preview) {
          event.preventDefault();
          alert("Preview only. No reupload request was sent.");
          return;
        }
        const field = event.currentTarget.elements.namedItem("name");
        if (field instanceof HTMLInputElement)
          field.value = localStorage.getItem("wavecase.name") || "";
      }}
    >
      <input type="hidden" name="name" />
      <button>Request reupload</button>
      {requested && <p role="status">Your reupload request has been sent.</p>}
    </Form>
  );
}
