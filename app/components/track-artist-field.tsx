import { useId, useState } from "react";

export function TrackArtistField({
  profiles,
  artistId = null,
  name = "",
  confirmMove = false,
}: {
  profiles: { id: string; name: string; slug: string }[];
  artistId?: string | null;
  name?: string;
  confirmMove?: boolean;
}) {
  const [selected, setSelected] = useState(artistId || "");
  const [enteredName, setEnteredName] = useState(name);
  const matches = profiles.filter(
    (profile) =>
      profile.name.trim().toLowerCase() === enteredName.trim().toLowerCase(),
  );
  const destination =
    profiles.find((profile) => profile.id === selected) ||
    (!selected && matches.length === 1 ? matches[0] : null);
  const moving = confirmMove && (destination?.id || null) !== artistId;
  const suggestions = useId();
  return (
    <>
      {!!profiles.length && (
        <label>
          Artist
          <select
            name="artistId"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Enter another artist name</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
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
            value={enteredName}
            onChange={(event) => setEnteredName(event.target.value)}
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
      {moving && (
        <label key={destination?.id || "personal"}>
          <input
            type="checkbox"
            name="confirmArtistMove"
            value="yes"
            required
          />
          {destination
            ? `Move this demo to ${destination.name}? Only that artist’s co-owners will have private access.`
            : "Make this demo personal? Only you will have private access."}{" "}
          All versions, discussions, share links, feedback and statistics move
          with it. Existing external links keep working. I confirm this change.
        </label>
      )}
    </>
  );
}
