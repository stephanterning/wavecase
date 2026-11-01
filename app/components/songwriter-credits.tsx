import { PublicLink } from "./public-links";
import { Fragment } from "react";

import { songwriters, songwriterPath } from "../domain/songwriters";

export function SongwriterCredits({ value }: { value: string }) {
  return songwriters(value).map(({ name, slug }, index) => (
    <Fragment key={slug || name}>
      {index > 0 && ", "}
      {slug ? <PublicLink to={songwriterPath(slug)}>{name}</PublicLink> : name}
    </Fragment>
  ));
}
