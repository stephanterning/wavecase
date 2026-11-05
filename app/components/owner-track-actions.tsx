import type { loader } from "../routes/track";
import { EditForm } from "./editing";
import {
  defaultVersionStatus,
  nextVersionName,
  versionNameFromFile,
  versionStatuses,
} from "../domain/versions";

type Version = Awaited<ReturnType<typeof loader>>["versions"][number];

export function OwnerTrackActions({
  versions,
  onUploaded,
}: {
  versions: Version[];
  onUploaded: (versionId: string) => void;
}) {
  const nextName = nextVersionName(versions.map((v) => v.name));
  return (
    <nav className="section-nav" aria-label="Track actions">
      <EditForm
        id="upload-new-version"
        label="New version"
        trigger="Upload new version"
        resetOnSave
        encType="multipart/form-data"
        onSuccess={(saved) => {
          if ("version" in saved && typeof saved.version === "string")
            onUploaded(saved.version);
        }}
        actions={<button className="button-primary">Upload new version</button>}
      >
        <input type="hidden" name="intent" value="upload-version" />
        <label>
          Audio file
          <input
            type="file"
            name="audio"
            required
            onChange={(e) => {
              const file = e.target.files?.[0];
              const field = e.target.form?.elements.namedItem("name");
              if (file && field instanceof HTMLInputElement)
                field.value = versionNameFromFile(file.name) || nextName;
            }}
          />
        </label>
        <label>
          Version name
          <input name="name" required defaultValue={nextName} />
        </label>
        <label>
          Status
          <select
            name="status"
            defaultValue={versions[0]?.status ?? defaultVersionStatus}
          >
            {versionStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea name="description" />
        </label>
        <label className="check">
          <input type="checkbox" name="download" />
          Allow downloads
        </label>
      </EditForm>
    </nav>
  );
}
