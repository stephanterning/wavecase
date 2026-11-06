import { WorkspacePlayerProvider } from "../components/workspace-player";
import { WorkspaceNavigation } from "../components/workspace-navigation";
import { viewer } from "../server/security";
import type { LoaderFunctionArgs } from "react-router";
import { EditingProvider } from "../components/editing";
import { loginDestination } from "../domain/login-destination";
import { Outlet, redirect, useLoaderData } from "react-router";

export async function loader({ request, url }: LoaderFunctionArgs) {
  const user = await viewer(request);
  if (!user) {
    const returnTo = loginDestination(url.pathname);
    throw redirect(
      returnTo === "/dashboard"
        ? "/"
        : "/?returnTo=" + encodeURIComponent(returnTo),
    );
  }
  return { userId: user.id };
}

export default function Workspace() {
  const { userId } = useLoaderData<typeof loader>();
  return (
    <WorkspacePlayerProvider key={userId}>
      <div className="workspace">
        <aside className="workspace-sidebar">
          <WorkspaceNavigation />
        </aside>
        <div className="workspace-content">
          <EditingProvider>
            <Outlet />
          </EditingProvider>
        </div>
      </div>
    </WorkspacePlayerProvider>
  );
}
