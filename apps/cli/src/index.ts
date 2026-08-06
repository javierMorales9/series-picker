#!/usr/bin/env bun
import type { EntryStatus, TmdbType } from "@series-raqui/domain";
import { JobCoordinator, SyncAllRunner } from "@series-raqui/jobs";
import { bootstrap } from "../../shared/bootstrap.ts";

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
function output(value: unknown, message?: string) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (message) console.log(message);
  else console.dir(value, { depth: 6, colors: true });
}
function help() {
  console.log(`Series Raqui

series search <texto> [--json]
series add --tmdb <tv:id|movie:id>
series sync --work <id|tv:id|movie:id>
series sync-all
series next --entry <id>
series transition --entry <id> --to <estado> [--force] [--watched-at <ISO>]
series edit-entry --entry <id> [--locations <csv>] [--platforms <csv>] [--availability <estado>]
series abandon --entry <id> --reason <motivo>
series discard --work <id> --reason <motivo>
series jobs active|show <id>|cancel <id>|list
series validate`);
}

if (!command || command === "help" || command === "--help") {
  help();
  process.exit(0);
}

const needsTmdb = ["search", "add", "sync", "sync-all"].includes(command);
const context = bootstrap({ requireTmdb: needsTmdb });

try {
  switch (command) {
    case "search": {
      const query = required(args.join(" "), "Falta el texto de búsqueda.");
      const results = await context.app.searchCatalog(query);
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
      const result = await context.app.addWork(ref.type, ref.id);
      output(
        result,
        `${result.created ? "Añadida" : "Actualizada"}: ${result.aggregate.work.name}\n${result.changes.join("\n")}`,
      );
      break;
    }
    case "sync": {
      const reference = required(option("--work"), "Falta --work.");
      const parsed = /^(tv|movie):/.test(reference) ? tmdbRef(reference) : null;
      const result = parsed
        ? await context.app.addWork(parsed.type, parsed.id)
        : await context.app.syncWork(reference);
      output(
        result,
        `${result.aggregate.work.name}: ${result.changes.length ? result.changes.join(", ") : "sin cambios"}`,
      );
      break;
    }
    case "sync-all": {
      const coordinator = new JobCoordinator(context.jobs);
      const job = coordinator.create("cli");
      const result = await new SyncAllRunner(context.app, context.jobs).run(
        job.id,
      );
      output(
        { job: result, items: context.jobs.listItems(job.id) },
        `Sincronización ${result.status}: ${result.completedItems}/${result.totalItems}`,
      );
      break;
    }
    case "next": {
      const result = context.app.advanceEntry(
        required(option("--entry"), "Falta --entry."),
      );
      output(result, `Actualizada: ${result.work.name}`);
      break;
    }
    case "transition": {
      const entryId = required(option("--entry"), "Falta --entry.");
      const target = required(option("--to"), "Falta --to.") as EntryStatus;
      const valid: EntryStatus[] = [
        "unplanned",
        "selected",
        "ready",
        "watching",
        "watched",
        "abandoned",
      ];
      if (!valid.includes(target))
        throw Object.assign(new Error(`Estado inválido: ${target}`), {
          code: "INVALID_ENTRY_STATUS",
        });
      const result = context.app.transitionEntry(entryId, target, {
        force: takeFlag("--force"),
        watchedAt: option("--watched-at"),
        reason: option("--reason"),
      });
      output(result, `Actualizada: ${result.work.name}`);
      break;
    }
    case "edit-entry": {
      const entryId = required(option("--entry"), "Falta --entry.");
      const availability = option("--availability") as
        | "unknown"
        | "available"
        | "unavailable"
        | undefined;
      if (
        availability &&
        !["unknown", "available", "unavailable"].includes(availability)
      )
        throw Object.assign(new Error("Disponibilidad inválida."), {
          code: "INVALID_AVAILABILITY",
        });
      const csv = (value: string | undefined) =>
        value
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      const result = context.app.updateEntryDetails(entryId, {
        locations: csv(option("--locations")),
        platforms: csv(option("--platforms")),
        availability,
      });
      output(result, `Datos actualizados: ${result.work.name}`);
      break;
    }
    case "abandon": {
      const result = context.app.abandonEntry(
        required(option("--entry"), "Falta --entry."),
        required(option("--reason"), "Falta --reason."),
      );
      output(result, `Abandonada: ${result.work.name}`);
      break;
    }
    case "discard": {
      const result = context.app.discardWork(
        required(option("--work"), "Falta --work."),
        required(option("--reason"), "Falta --reason."),
      );
      output(result, `Descartada: ${result.work.name}`);
      break;
    }
    case "jobs": {
      const sub = args.shift() ?? "list";
      if (sub === "active") output(context.jobs.findActive());
      else if (sub === "list") output(context.jobs.listRecent());
      else if (sub === "show") {
        const id = required(args.shift(), "Falta el ID.");
        output({
          job: context.jobs.findById(id),
          items: context.jobs.listItems(id),
        });
      } else if (sub === "cancel") {
        const id = required(args.shift(), "Falta el ID.");
        context.jobs.requestCancellation(id);
        output({ id }, `Cancelación solicitada: ${id}`);
      } else
        throw Object.assign(new Error(`Subcomando desconocido: ${sub}`), {
          code: "INVALID_ARGUMENTS",
        });
      break;
    }
    case "validate": {
      const errors = context.app.validateLibrary();
      output(
        errors,
        errors.length
          ? errors
              .map((e) => `${e.workId}: ${e.code} — ${e.message}`)
              .join("\n")
          : "Biblioteca válida.",
      );
      if (errors.length) process.exitCode = 1;
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
} finally {
  context.db.close();
}
