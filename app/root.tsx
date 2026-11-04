import type { LoaderFunctionArgs } from "react-router";
import { viewer } from "./server/security";
import {
  Form,
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
import "./style.css";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await viewer(request);
  return { user: user ? { name: user.name, admin: user.admin } : null };
}
export const meta = () => [{ title: "Wavecase" }];
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const { pathname } = useLocation();
  const publicPage = /^\/(artists|songwriter|s)(\/|$)/.test(pathname);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <div className="brand-controls">
            {publicPage ? (
              <span className="brand">▥ wavecase</span>
            ) : (
              <a href="/" className="brand">
                ▥ wavecase
              </a>
            )}
            {!publicPage && data?.user?.admin && (
              <a
                className="header-icon"
                href="/admin"
                aria-label="Installation settings"
                title="Installation settings"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-3Z" />
                  <circle cx="12" cy="11" r="3" />
                </svg>
              </a>
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
                  <a href="/account">Your account</a>
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
