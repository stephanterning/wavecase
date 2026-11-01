import { Link, useSearchParams, type LinkProps } from "react-router";
export function PublicLink({ to, ...props }: LinkProps & { to: string }) {
  const [search] = useSearchParams();
  return (
    <Link
      {...props}
      to={
        search.get("preview") === "1"
          ? `${to}${to.includes("?") ? "&" : "?"}preview=1`
          : to
      }
    />
  );
}
