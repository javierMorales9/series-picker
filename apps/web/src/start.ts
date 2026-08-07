import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import {
  attemptLogin,
  expiredSessionCookie,
  isAuthenticated,
  lockoutRemainingMs,
  sessionCookie,
} from "./server/auth.ts";

const LOGIN_PATH = "/login";
const LOGOUT_PATH = "/logout";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** Sólo admitimos rutas internas para que nadie use ?redirect= como salto a otro dominio. */
function safeRedirectTarget(value: string | null): string {
  if (!value?.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

function loginUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search ? `${LOGIN_PATH}?${search}` : LOGIN_PATH;
}

async function handleLogin(request: Request, secure: boolean) {
  const waitMs = lockoutRemainingMs();
  if (waitMs > 0) {
    return redirect(
      loginUrl({
        error: "bloqueado",
        minutos: String(Math.ceil(waitMs / 60_000)),
      }),
    );
  }
  const form = await request.formData();
  const password = form.get("password");
  const target = safeRedirectTarget(String(form.get("redirect") ?? "/"));
  if (typeof password !== "string" || !attemptLogin(password)) {
    return redirect(loginUrl({ error: "credenciales", redirect: target }));
  }
  return redirect(target, await sessionCookie(secure));
}

const authMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, pathname, next, handlerType }) => {
    const secure =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";

    if (pathname === LOGOUT_PATH) {
      return request.method === "POST"
        ? redirect(LOGIN_PATH, expiredSessionCookie(secure))
        : redirect("/");
    }

    if (pathname === LOGIN_PATH) {
      if (request.method === "POST") return handleLogin(request, secure);
      if (await isAuthenticated()) return redirect("/");
      return next();
    }

    if (await isAuthenticated()) return next();

    // Las llamadas a server functions no navegan: responderles con un redirect
    // dejaría al cliente parseando el HTML del login como si fuese la respuesta.
    if (handlerType === "serverFn") {
      return new Response("No autorizado", { status: 401 });
    }

    const url = new URL(request.url);
    return redirect(loginUrl({ redirect: url.pathname + url.search }));
  },
);

export const startInstance = createStart(() => ({
  // Crear una instancia de Start sustituye el middleware CSRF que Start monta por
  // defecto, así que hay que volver a declararlo aquí de forma explícita.
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    authMiddleware,
  ],
}));
