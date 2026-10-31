import { Outlet } from "react-router";
import { ReleasePlayerProvider } from "../components/release-player";

export default function PublicMusic() {
  return (
    <ReleasePlayerProvider>
      <Outlet />
    </ReleasePlayerProvider>
  );
}
