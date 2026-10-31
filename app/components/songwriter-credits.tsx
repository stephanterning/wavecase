import { Fragment } from "react";
import { Link } from "react-router";
import { songwriters, songwriterPath } from "../domain/songwriters";

export function SongwriterCredits({ value }: { value: string }) {
  return songwriters(value).map(({ name, slug }, index) => (
    <Fragment key={slug || name}>
      {index > 0 && ", "}
      {slug ? <Link to={songwriterPath(slug)}>{name}</Link> : name}
    </Fragment>
  ));
}
