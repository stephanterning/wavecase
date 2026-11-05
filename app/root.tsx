import type { LoaderFunctionArgs } from "react-router";
import { viewer } from "./server/security";
import {
  Form,
  Link,
  Links,
  useRouteLoaderData,
  useLocation,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import { Icon } from "./components/icons";
import "./style.css";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await viewer(request);
  return { user: user ? { name: user.name, admin: user.admin } : null };
}
export const meta = () => [{ title: "Wavecase" }];
export const links = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const { pathname } = useLocation();
  const publicPage = /^\/(artists|songwriter|s)(\/|$)/.test(pathname);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="same-origin" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <div className="brand-controls">
            {publicPage ? (
              <span className="brand">▥ wavecase</span>
            ) : (
              <Link to={data?.user ? "/dashboard" : "/"} className="brand">
                ▥ wavecase
              </Link>
            )}
            {!publicPage && data?.user?.admin && (
              <Link
                className="header-icon"
                to="/admin"
                aria-label="Installation settings"
                title="Installation settings"
              >
                <Icon name="settings" size={24} />
              </Link>
            )}
          </div>
          {!publicPage && data?.user && (
            <>
              <button
                type="button"
                className="account-avatar"
                popoverTarget="account-menu"
                aria-label={`Account: ${data.user.name}`}
                title={data.user.name}
              >
                {Array.from(data.user.name.trim())[0]?.toLocaleUpperCase() ||
                  "?"}
              </button>
              <div id="account-menu" popover="auto" className="account-menu">
                <nav aria-label="Account">
                  <Link
                    to="/account"
                    onClick={(event) =>
                      event.currentTarget
                        .closest<HTMLElement>("[popover]")
                        ?.hidePopover?.()
                    }
                  >
                    Your account
                  </Link>
                  <Form method="post" action="/logout">
                    <button type="submit">Log out</button>
                  </Form>
                </nav>
              </div>
            </>
          )}
        </header>
        <main>{children}</main>
        <footer>
          <a href="https://github.com/stephanterning/wavecase">
            Source code · AGPL-3.0
          </a>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  return <Outlet />;
}
export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <section className="panel">
      <h1>Something needs attention</h1>
      <p role="alert">
        {isRouteErrorResponse(error)
          ? String(error.data)
          : "An unexpected error occurred. Please try again."}
      </p>
      <a href="/">Go home</a>
    </section>
  );
}
