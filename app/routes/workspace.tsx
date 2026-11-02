import { Icon } from "../components/icons";
import { EditingProvider } from "../components/editing";
import { useRef } from "react";
import { Outlet, useLocation } from "react-router";

export default function Workspace() {
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = [
    ["/dashboard", "Dashboard", "dashboard"],
    ["/library", "Work in progress", "waveform"],
    ["/releases", "Releases", "disc"],
    ["/artist-profiles", "Artists", "artists"],
  ] as const;
  const navigation = (
    <nav aria-label="Workspace">
      {items.map(([href, label, icon]) => (
        <a
          key={href}
          href={href}
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
        </a>
      ))}
    </nav>
  );
  return (
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
  );
}
