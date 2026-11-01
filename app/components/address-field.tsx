import { slugify } from "../domain/releases";
export function AddressField({
  name,
  prefix,
  value,
  onChange,
}: {
  name: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const suggested = slugify(name);
  return (
    <label>
      Public address
      <input
        name="slug"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={suggested || "suggested-from-name"}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        maxLength={100}
      />
      <small>
        {prefix}/{value || suggested || "…"}
      </small>
      <small>
        Leave blank to use the suggestion. The address cannot be changed after
        creation.
      </small>
    </label>
  );
}
