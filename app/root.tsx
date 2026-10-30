import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import "./style.css";
export const meta = () => [{ title: "Wavecase" }];
export function Layout({ children }: { children: React.ReactNode }) {
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
          <a href="/" className="brand">
            ▥ wavecase
          </a>
          <span>Music in the making.</span>
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
