import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { Icon } from "./icons";
import { IconButton } from "./icon-button";

const items = [
  ["/dashboard", "Dashboard", "dashboard"],
  ["/library", "Work in progress", "waveform"],
  ["/releases", "Releases", "disc"],
  ["/artist-profiles", "Artists", "artists"],
] as const;

export function WorkspaceNavigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Workspace" className="workspace-navigation">
      {items.map(([href, label, icon]) => (
        <Link
          key={href}
          to={href}
          onClick={onNavigate}
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
}

export function WorkspaceMenu() {
  const { pathname } = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => dialog.current?.close();
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 900px)");
    const onChange = () => {
      if (desktop.matches) dialog.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);
  return (
    <>
      <IconButton
        icon="menu"
        label="Open navigation"
        className="header-icon workspace-menu"
        ref={trigger}
        aria-haspopup="dialog"
        aria-controls="workspace-menu"
        onClick={() => dialog.current?.showModal()}
      />
      <dialog
        id="workspace-menu"
        className="workspace-drawer"
        ref={dialog}
        aria-labelledby="workspace-menu-heading"
        onClose={() => trigger.current?.focus({ preventScroll: true })}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="workspace-menu-heading">Navigation</h2>
          <IconButton
            icon="close"
            label="Close navigation"
            className="icon-action"
            onClick={close}
          />
        </div>
        <WorkspaceNavigation onNavigate={close} />
      </dialog>
    </>
  );
}
