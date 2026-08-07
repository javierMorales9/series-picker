import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface AppConfig {
  databasePath: string;
  tmdbAccessToken: string;
  port: number;
  /** Contraseña compartida que da acceso a la web. Vacía si no se ha configurado. */
  authPassword: string;
  /** Clave derivada con la que se sella la cookie de sesión. Siempre 64 caracteres. */
  sessionSecret: string;
}

export function workspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    const manifest = resolve(current, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === "series-raqui")
          return current;
      } catch {}
    }
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

export function loadConfig(
  options: { requireTmdb?: boolean; requireAuth?: boolean } = {},
): AppConfig {
  const configuredPath =
    process.env.DATABASE_PATH || ".data/series-raqui.sqlite";
  const databasePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(workspaceRoot(), configuredPath);
  const tmdbAccessToken = process.env.TMDB_ACCESS_TOKEN?.trim() ?? "";
  if (options.requireTmdb && !tmdbAccessToken) {
    throw new Error(
      "Falta TMDB_ACCESS_TOKEN. Copia .env.example a .env y configúralo.",
    );
  }
  const authPassword = process.env.APP_PASSWORD?.trim() ?? "";
  if (options.requireAuth && !authPassword) {
    throw new Error(
      "Falta APP_PASSWORD. Sin ella la biblioteca quedaría abierta a cualquiera.",
    );
  }
  // El sellado de la cookie exige una clave de 32 caracteres como mínimo, así que
  // siempre derivamos una en vez de usar el valor crudo. Sin SESSION_SECRET la
  // clave sale de la contraseña, de modo que cambiarla cierra las sesiones abiertas.
  const sessionSecret = createHash("sha256")
    .update(
      `series-raqui/session/${process.env.SESSION_SECRET?.trim() || authPassword}`,
    )
    .digest("hex");
  return {
    databasePath,
    tmdbAccessToken,
    port: Number(process.env.PORT || 3000),
    authPassword,
    sessionSecret,
  };
}
