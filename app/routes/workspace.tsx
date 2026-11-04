import { WorkspacePlayerProvider } from "../components/workspace-player";
import { requireUser } from "../server/security";
import type { LoaderFunctionArgs } from "react-router";
import { Icon } from "../components/icons";
import { EditingProvider } from "../components/editing";
import { useRef, useEffect } from "react";
import { Link, Outlet, useLoaderData, useLocation } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return { userId: user.id };
}

export default function Workspace() {
  const { userId } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);
  const items = [
    ["/dashboard", "Dashboard", "dashboard"],
    ["/library", "Work in progress", "waveform"],
    ["/releases", "Releases", "disc"],
    ["/artist-profiles", "Artists", "artists"],
  ] as const;
  const navigation = (
    <nav aria-label="Workspace">
      {items.map(([href, label, icon]) => (
        <Link
          key={href}
          to={href}
          aria-current={
            pathname === href ||
            pathname.startsWith(href + "/") ||
            (href === "/library" && pathname.startsWith("/tracks/"))
              ? "page"
              : undefined
          }
        >
          <Icon name={icon} />
          {label}
        </Link>
      ))}
    </nav>
  );
  return (
    <WorkspacePlayerProvider key={userId}>
      <div className="workspace">
        <aside className="workspace-sidebar">{navigation}</aside>
        <div className="workspace-content">
          <button
            className="workspace-menu"
            ref={trigger}
            onClick={() => dialog.current?.showModal()}
          >
            Menu
          </button>
          <EditingProvider>
            <Outlet />
          </EditingProvider>
        </div>
        <dialog
          className="workspace-drawer"
          ref={dialog}
          onClose={() => trigger.current?.focus()}
          aria-label="Workspace navigation"
        >
          <button onClick={() => dialog.current?.close()}>Close menu</button>
          {navigation}
        </dialog>
      </div>
    </WorkspacePlayerProvider>
  );
}
