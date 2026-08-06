import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface AppConfig {
  databasePath: string;
  tmdbAccessToken: string;
  port: number;
}

export function workspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    const manifest = resolve(current, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === "series-raqui")
          return current;
      } catch { }
    }
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

export function loadConfig(options: { requireTmdb?: boolean } = {}): AppConfig {
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
  return {
    databasePath,
    tmdbAccessToken,
    port: Number(process.env.PORT || 3000),
  };
}
