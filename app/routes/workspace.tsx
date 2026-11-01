import { useRef } from "react";
import { Outlet, useLocation } from "react-router";

export default function Workspace() {
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = [
    ["/dashboard", "Dashboard"],
    ["/library", "Work in progress"],
    ["/releases", "Releases"],
    ["/artist-profiles", "Artists"],
  ];
  const navigation = (
    <nav aria-label="Workspace">
      {items.map(([href, label]) => (
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
        <Outlet />
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
