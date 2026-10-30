import { useId, useState } from "react";

export function TrackArtistField({
  profiles,
  artistId = null,
  name = "",
}: {
  profiles: { id: string; name: string; slug: string }[];
  artistId?: string | null;
  name?: string;
}) {
  const [selected, setSelected] = useState(artistId || "");
  const suggestions = useId();
  return (
    <>
      {!!profiles.length && (
        <label>
          Artist profile
          <select
            name="artistId"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Match by name / free text</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} (/{profile.slug})
              </option>
            ))}
          </select>
        </label>
      )}
      {!selected && (
        <label>
          Artist name
          <input
            name="artist"
            defaultValue={name}
            maxLength={200}
            list={suggestions}
          />
          <datalist id={suggestions}>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.name} />
            ))}
          </datalist>
        </label>
      )}
      <p className="muted">
        A unique matching profile in your account is linked automatically. Other
        names stay as plain text. Linking an artist does not publish this demo.
      </p>
    </>
  );
}
