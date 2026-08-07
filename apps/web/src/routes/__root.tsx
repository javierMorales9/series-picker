import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Series Raqui" },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="page">
      <p className="eyebrow">Error</p>
      <h1>Algo ha fallado</h1>
      <p className="error">{error.message}</p>
      <Link to="/">Volver a la biblioteca</Link>
    </div>
  ),
  component: Root,
});

function Root() {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="topbar">
          <Link to="/" className="brand">
            Series Raqui
          </Link>
          <nav>
            <Link to="/">Biblioteca</Link>
            <Link to="/jobs">Sincronización</Link>
          </nav>
        </header>
        <main>
          <Outlet />
        </main>
        <footer>
          Hecho por{" "}
          <a
            href="https://github.com/javierMorales9"
            target="_blank"
            rel="noreferrer"
          >
            Javier Morales
          </a>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}
