import { Fragment } from "react";
import { songwriters, songwriterPath } from "../domain/songwriters";

export function SongwriterCredits({ value }: { value: string }) {
  return songwriters(value).map(({ name, slug }, index) => (
    <Fragment key={slug || name}>
      {index > 0 && ", "}
      {slug ? <a href={songwriterPath(slug)}>{name}</a> : name}
    </Fragment>
  ));
}
