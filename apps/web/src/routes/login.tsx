import { createFileRoute } from "@tanstack/react-router";

interface LoginSearch {
  error?: string;
  minutos?: string;
  redirect?: string;
}

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: clean(search.error),
    minutos: clean(search.minutos),
    redirect: clean(search.redirect),
  }),
  head: () => ({ meta: [{ title: "Entrar · Series Raqui" }] }),
  component: Login,
});

function Login() {
  const { error, minutos, redirect } = Route.useSearch();
  const message =
    error === "bloqueado"
      ? `Demasiados intentos fallidos. Prueba otra vez en ${minutos ?? "unos"} minutos.`
      : error === "credenciales"
        ? "La contraseña no es correcta."
        : undefined;

  return (
    <div className="page login">
      <p className="eyebrow">Series Raqui</p>
      <h1>Entrar</h1>
      {/* Formulario nativo: lo intercepta el middleware de petición, sin JS de por medio. */}
      <form method="post" action="/login" className="login-form">
        <input type="hidden" name="redirect" value={redirect ?? "/"} />
        <label className="field">
          <span className="field-label">Contraseña</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            // biome-ignore lint/a11y/noAutofocus: es el único campo de la página.
            autoFocus
            required
          />
        </label>
        {message ? <p className="error">{message}</p> : null}
        <button type="submit" className="button">
          Entrar
        </button>
      </form>
    </div>
  );
}
