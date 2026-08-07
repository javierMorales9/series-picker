#!/usr/bin/env bun
import type { TmdbType } from "@series-raqui/domain";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const command = args.shift();

function takeFlag(name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
function required(value: string | undefined, message: string): string {
  if (!value)
    throw Object.assign(new Error(message), { code: "INVALID_ARGUMENTS" });
  return value;
}
function tmdbRef(value: string): { type: TmdbType; id: number } {
  const match = /^(tv|movie):(\d+)$/.exec(value);
  if (!match)
    throw Object.assign(
      new Error("Usa una referencia como tv:95396 o movie:157336."),
      { code: "INVALID_TMDB_REF" },
    );
  return { type: match[1] as TmdbType, id: Number(match[2]) };
}
function csv(value: string | undefined): string[] | undefined {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function output(value: unknown, message?: string) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (message) console.log(message);
  else console.dir(value, { depth: 6, colors: true });
}
function help() {
  console.log(`Series Raqui

La CLI habla con la API de la instancia desplegada. Configura:
  SERIES_API_URL   por defecto http://localhost:3000
  API_TOKEN        el mismo valor que tenga el servicio

series status [--json]
series list [--status <estado>] [--json]
series search <texto> [--json]
series add --tmdb <tv:id|movie:id> [--json]
series advance --entry <id> [--json]          (alias: next)
series transition --entry <id> --to <estado> [--reason <motivo>] [--force] [--watched-at <ISO>] [--json]
series edit-entry --entry <id> [--locations <csv>] [--platforms <csv>] [--availability <estado>] [--json]
series abandon --entry <id> --reason <motivo> [--json]
series discard --work <id> --reason <motivo> [--json]
series sync-all [--no-wait] [--json]`);
}

if (!command || command === "help" || command === "--help") {
  help();
  process.exit(0);
}

const baseUrl = (process.env.SERIES_API_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const token = process.env.API_TOKEN?.trim();

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!token)
    throw Object.assign(
      new Error("Falta API_TOKEN. Es el mismo valor que tenga el servicio."),
      { code: "MISSING_API_TOKEN" },
    );
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json; charset=utf-8" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        `No se pudo conectar con ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { code: "CONNECTION_FAILED" },
    );
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw Object.assign(
      new Error(
        `Respuesta no JSON (${response.status}): ${text.slice(0, 200)}`,
      ),
      { code: "INVALID_RESPONSE" },
    );
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : undefined;
    throw Object.assign(
      new Error(error?.message ?? `La API respondió ${response.status}.`),
      { code: error?.code ?? `HTTP_${response.status}` },
    );
  }
  return payload;
}

interface JobResponse {
  id: string;
  status: string;
  totalItems: number;
  completedItems: number;
  changedItems: number;
  failedItems: number;
  error: string | null;
}

// Un worker que muere deja el job en running: sin tope, un cron se quedaría colgado.
const TERMINAL_JOB_STATUSES = [
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
  "interrupted",
];
const WAIT_LIMIT_MS = 30 * 60_000;
const showProgress = !json && process.stderr.isTTY === true;

interface StatusResponse {
  total: number;
  counts: Record<string, number>;
  watching: Array<{
    name: string;
    nextEntryId: string | null;
    nextEntryName: string | null;
    nextEntryStatus: string | null;
  }>;
  selected: StatusResponse["watching"];
  started: StatusResponse["watching"];
  unplanned: StatusResponse["watching"];
}

try {
  switch (command) {
    case "status": {
      const result = (await call("GET", "/api/status")) as StatusResponse;
      const lines = [
        `Total: ${result.total}`,
        ...Object.entries(result.counts)
          .filter(([, count]) => count > 0)
          .map(([status, count]) => `  ${status}: ${count}`),
      ];
      for (const [label, group] of [
        ["Viendo", result.watching],
        ["Seleccionadas", result.selected],
        ["Empezadas", result.started],
        ["Sin planificar", result.unplanned],
      ] as const) {
        if (!group.length) continue;
        lines.push("", label);
        for (const work of group) {
          lines.push(
            `  ${work.name} — ${work.nextEntryName ?? "sin entrega"}` +
              `${work.nextEntryStatus ? ` (${work.nextEntryStatus})` : ""}` +
              `${work.nextEntryId ? `\t${work.nextEntryId}` : ""}`,
          );
        }
      }
      output(result, lines.join("\n"));
      break;
    }
    case "list": {
      const status = option("--status");
      const results = (await call(
        "GET",
        `/api/works${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      )) as Array<{
        id: string;
        name: string;
        status: string;
        totalEntries: number;
        watchedEntries: number;
      }>;
      output(
        results,
        results.length
          ? results
              .map(
                (work) =>
                  `${work.name}\t${work.status}\t${work.watchedEntries}/${work.totalEntries}\t${work.id}`,
              )
              .join("\n")
          : "Sin resultados.",
      );
      break;
    }
    case "search": {
      const query = required(args.join(" "), "Falta el texto de búsqueda.");
      const results = (await call(
        "GET",
        `/api/search?q=${encodeURIComponent(query)}`,
      )) as Array<{
        tmdbType: string;
        tmdbId: number;
        name: string;
        year?: number | null;
      }>;
      output(
        results,
        results
          .map(
            (item) =>
              `${item.tmdbType}:${item.tmdbId}\t${item.name}${item.year ? ` (${item.year})` : ""}`,
          )
          .join("\n"),
      );
      break;
    }
    case "add": {
      const ref = tmdbRef(required(option("--tmdb"), "Falta --tmdb."));
      const result = (await call("POST", "/api/works", {
        tmdbType: ref.type,
        tmdbId: ref.id,
      })) as {
        created: boolean;
        work: { name: string };
        changes: string[];
      };
      output(
        result,
        `${result.created ? "Añadida" : "Actualizada"}: ${result.work.name}` +
          (result.changes.length ? `\n${result.changes.join("\n")}` : ""),
      );
      break;
    }
    case "next":
    case "advance": {
      const entryId = required(option("--entry"), "Falta --entry.");
      const result = (await call(
        "POST",
        `/api/entries/${encodeURIComponent(entryId)}/advance`,
      )) as { work: { name: string }; entry: { name: string; status: string } };
      output(
        result,
        `${result.work.name} — ${result.entry.name}: ${result.entry.status}`,
      );
      break;
    }
    case "transition": {
      const entryId = required(option("--entry"), "Falta --entry.");
      const target = required(option("--to"), "Falta --to.");
      const result = (await call(
        "POST",
        `/api/entries/${encodeURIComponent(entryId)}/transition`,
        {
          target,
          reason: option("--reason"),
          force: takeFlag("--force"),
          watchedAt: option("--watched-at"),
        },
      )) as { work: { name: string }; entry: { name: string; status: string } };
      output(
        result,
        `${result.work.name} — ${result.entry.name}: ${result.entry.status}`,
      );
      break;
    }
    case "edit-entry": {
      const entryId = required(option("--entry"), "Falta --entry.");
      const result = (await call(
        "PATCH",
        `/api/entries/${encodeURIComponent(entryId)}`,
        {
          locations: csv(option("--locations")),
          platforms: csv(option("--platforms")),
          availability: option("--availability"),
        },
      )) as {
        work: { name: string };
        entry: { name: string; locations: string[]; platforms: string[] };
      };
      output(
        result,
        `${result.work.name} — ${result.entry.name}: ` +
          `${result.entry.locations.join(", ") || "sin lugares"} · ` +
          `${result.entry.platforms.join(", ") || "sin plataformas"}`,
      );
      break;
    }
    case "abandon": {
      // Abandonar es una transición más; no hace falta endpoint propio.
      const entryId = required(option("--entry"), "Falta --entry.");
      const reason = required(option("--reason"), "Falta --reason.");
      const result = (await call(
        "POST",
        `/api/entries/${encodeURIComponent(entryId)}/transition`,
        { target: "abandoned", reason },
      )) as { work: { name: string }; entry: { name: string; status: string } };
      output(result, `Abandonada: ${result.work.name} — ${result.entry.name}`);
      break;
    }
    case "discard": {
      const workId = required(option("--work"), "Falta --work.");
      const reason = required(option("--reason"), "Falta --reason.");
      const result = (await call(
        "POST",
        `/api/works/${encodeURIComponent(workId)}/discard`,
        { reason },
      )) as { work: { name: string; status: string } };
      output(result, `Descartada: ${result.work.name}`);
      break;
    }
    case "sync-all": {
      const noWait = takeFlag("--no-wait");
      const started = (await call("POST", "/api/jobs/sync-all")) as JobResponse;
      if (noWait) {
        output(started, `Sincronización lanzada: ${started.id}`);
        break;
      }
      const deadline = Date.now() + WAIT_LIMIT_MS;
      let current = started;
      while (!TERMINAL_JOB_STATUSES.includes(current.status)) {
        if (Date.now() > deadline) {
          throw Object.assign(
            new Error(
              `La sincronización sigue en ${current.status} tras ${WAIT_LIMIT_MS / 60_000} minutos. Job ${current.id}.`,
            ),
            { code: "SYNC_TIMEOUT" },
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const detail = (await call("GET", `/api/jobs/${started.id}`)) as {
          job: JobResponse;
        };
        current = detail.job;
        // Progreso por stderr y sólo en terminal: en un cron o una tubería el
        // \r no borra nada y acabaría ensuciando el log.
        if (showProgress) {
          process.stderr.write(
            `\r${current.completedItems}/${current.totalItems}   `,
          );
        }
      }
      if (showProgress) process.stderr.write(`\r${" ".repeat(24)}\r`);
      output(
        current,
        `Sincronización ${current.status}: ${current.completedItems}/${current.totalItems}` +
          (current.changedItems
            ? `, ${current.changedItems} con cambios`
            : "") +
          (current.failedItems ? `, ${current.failedItems} con error` : "") +
          (current.error ? `\n${current.error}` : ""),
      );
      if (current.status !== "completed") process.exitCode = 1;
      break;
    }
    default:
      throw Object.assign(new Error(`Comando desconocido: ${command}`), {
        code: "INVALID_ARGUMENTS",
      });
  }
} catch (error) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "UNEXPECTED_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  if (json)
    console.error(JSON.stringify({ error: { code, message } }, null, 2));
  else console.error(`${code}: ${message}`);
  process.exitCode = 1;
}
