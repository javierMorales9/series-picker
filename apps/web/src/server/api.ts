import "@tanstack/react-start/server-only";
import type { WorkSummary } from "@series-raqui/application";
import type {
  Availability,
  EntryStatus,
  WorkAggregate,
  WorkStatus,
} from "@series-raqui/domain";
import { JobCoordinator } from "@series-raqui/jobs";
import { TmdbError } from "@series-raqui/tmdb";
import { getContext } from "./context.ts";

const ENTRY_STATUSES: EntryStatus[] = [
  "unplanned",
  "selected",
  "ready",
  "watching",
  "watched",
  "abandoned",
];
const WORK_STATUSES: WorkStatus[] = [
  "unplanned",
  "selected",
  "watching",
  "started",
  "completed",
  "abandoned",
  "discarded",
];
const AVAILABILITIES: Availability[] = ["unknown", "available", "unavailable"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function fail(code: string, message: string, status = 400): Response {
  return json({ error: { code, message } }, status);
}

/** La CLI sólo necesita lo justo para listar y navegar, no la Obra entera. */
function summarize(work: WorkSummary) {
  return {
    id: work.id,
    name: work.name,
    type: work.type,
    status: work.status,
    totalEntries: work.totalEntries,
    watchedEntries: work.watchedEntries,
    nextEntryId: work.nextEntryId,
    nextEntryName: work.nextEntryName,
    nextEntryStatus: work.nextEntryStatus,
    nextEntryAvailability: work.nextEntryAvailability,
  };
}

/** Las mutaciones devuelven el agregado entero; a la CLI le basta la Entrega tocada. */
function entryResult(aggregate: WorkAggregate, entryId: string) {
  const entry = aggregate.entries.find((candidate) => candidate.id === entryId);
  return {
    work: {
      id: aggregate.work.id,
      name: aggregate.work.name,
      status: aggregate.work.status,
    },
    entry: entry
      ? {
          id: entry.id,
          name: entry.name,
          status: entry.status,
          availability: entry.availability,
          locations: entry.locations,
          platforms: entry.platforms,
        }
      : null,
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("no es un objeto");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("El cuerpo debe ser un objeto JSON."), {
      code: "INVALID_JSON",
    });
  }
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw Object.assign(new Error(`${field} debe ser una lista de textos.`), {
      code: "INVALID_ARGUMENTS",
    });
  }
  return (value as string[]).map((item) => item.trim()).filter(Boolean);
}

async function route(
  request: Request,
  segments: string[],
  url: URL,
): Promise<Response> {
  const { app, jobs, config } = getContext();
  const [head, ...rest] = segments;

  if (head === "jobs") {
    if (
      rest.length === 1 &&
      rest[0] === "sync-all" &&
      request.method === "POST"
    ) {
      if (!config.tmdbAccessToken) {
        return fail("MISSING_TMDB_TOKEN", "Falta TMDB_ACCESS_TOKEN.", 503);
      }
      const coordinator = new JobCoordinator(jobs);
      const job = coordinator.create("cli");
      try {
        coordinator.launch(job.id);
      } catch (error) {
        // Si no arranca el proceso, el job no puede quedarse colgado en pending.
        jobs.finish(
          job.id,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      return json(jobs.findById(job.id), 202);
    }

    if (rest.length === 1 && rest[0] === "active" && request.method === "GET") {
      return json(jobs.findActive());
    }

    if (rest.length === 1 && request.method === "GET") {
      const job = jobs.findById(rest[0] as string);
      if (!job) return fail("JOB_NOT_FOUND", "No se encontró el job.", 404);
      return json({ job, items: jobs.listItems(job.id) });
    }
  }

  if (head === "status" && rest.length === 0 && request.method === "GET") {
    const dashboard = app.getDashboard();
    const counts = Object.fromEntries(
      WORK_STATUSES.map((status) => [
        status,
        dashboard.all.filter((work) => work.status === status).length,
      ]),
    ) as Record<WorkStatus, number>;
    return json({
      total: dashboard.all.length,
      counts,
      watching: dashboard.watching.map(summarize),
      selected: dashboard.selected.map(summarize),
      started: dashboard.started.map(summarize),
      unplanned: dashboard.unplanned.map(summarize),
    });
  }

  // Sin esto no hay forma de preguntar "¿qué hemos visto ya?", que es justo lo
  // que hace falta para pedir recomendaciones parecidas.
  if (head === "works" && rest.length === 0 && request.method === "GET") {
    const status = url.searchParams.get("status");
    if (status && !WORK_STATUSES.includes(status as WorkStatus)) {
      return fail(
        "INVALID_WORK_STATUS",
        `status debe ser uno de: ${WORK_STATUSES.join(", ")}.`,
      );
    }
    const all = app.getDashboard().all;
    const works = status ? all.filter((work) => work.status === status) : all;
    return json(works.map(summarize));
  }

  if (head === "search" && rest.length === 0 && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query) return fail("INVALID_ARGUMENTS", "Falta el parámetro q.");
    return json(await app.searchCatalog(query));
  }

  if (head === "works" && rest.length === 0 && request.method === "POST") {
    const body = await readBody(request);
    if (body.tmdbType !== "tv" && body.tmdbType !== "movie") {
      return fail("INVALID_ARGUMENTS", "tmdbType debe ser tv o movie.");
    }
    if (typeof body.tmdbId !== "number" || !Number.isInteger(body.tmdbId)) {
      return fail("INVALID_ARGUMENTS", "tmdbId debe ser un entero.");
    }
    const result = await app.addWork(body.tmdbType, body.tmdbId);
    return json(
      {
        created: result.created,
        work: {
          id: result.aggregate.work.id,
          name: result.aggregate.work.name,
          type: result.aggregate.work.type,
          status: result.aggregate.work.status,
          entries: result.aggregate.entries.length,
        },
        changes: result.changes,
      },
      result.created ? 201 : 200,
    );
  }

  if (
    head === "works" &&
    rest.length === 2 &&
    rest[1] === "discard" &&
    request.method === "POST"
  ) {
    const body = await readBody(request);
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return fail("INVALID_ARGUMENTS", "Hace falta un motivo (reason).");
    }
    const changed = app.discardWork(rest[0] as string, body.reason.trim());
    return json({
      work: {
        id: changed.work.id,
        name: changed.work.name,
        status: changed.work.status,
        discardReason: changed.work.discardReason,
      },
    });
  }

  if (head === "entries" && rest.length >= 1) {
    const entryId = rest[0] as string;
    const action = rest[1];

    if (
      action === "advance" &&
      rest.length === 2 &&
      request.method === "POST"
    ) {
      return json(entryResult(app.advanceEntry(entryId), entryId));
    }

    if (
      action === "transition" &&
      rest.length === 2 &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      const target = body.target;
      if (
        typeof target !== "string" ||
        !ENTRY_STATUSES.includes(target as EntryStatus)
      ) {
        return fail(
          "INVALID_ENTRY_STATUS",
          `target debe ser uno de: ${ENTRY_STATUSES.join(", ")}.`,
        );
      }
      const changed = app.transitionEntry(entryId, target as EntryStatus, {
        reason: typeof body.reason === "string" ? body.reason : undefined,
        force: body.force === true,
        watchedAt:
          typeof body.watchedAt === "string" ? body.watchedAt : undefined,
      });
      return json(entryResult(changed, entryId));
    }

    if (rest.length === 1 && request.method === "PATCH") {
      const body = await readBody(request);
      const availability = body.availability;
      if (
        availability !== undefined &&
        (typeof availability !== "string" ||
          !AVAILABILITIES.includes(availability as Availability))
      ) {
        return fail(
          "INVALID_AVAILABILITY",
          `availability debe ser uno de: ${AVAILABILITIES.join(", ")}.`,
        );
      }
      const changed = app.updateEntryDetails(entryId, {
        locations: stringList(body.locations, "locations"),
        platforms: stringList(body.platforms, "platforms"),
        availability: availability as Availability | undefined,
      });
      return json(entryResult(changed, entryId));
    }
  }

  return fail(
    "NOT_FOUND",
    `Sin ruta para ${request.method} ${url.pathname}.`,
    404,
  );
}

export async function handleApi(request: Request, url: URL): Promise<Response> {
  const segments = url.pathname.slice("/api".length).split("/").filter(Boolean);
  try {
    return await route(request, segments, url);
  } catch (error) {
    // Un 404 de TMDB significa que el id no existe: es culpa de la petición,
    // no nuestra. El resto de fallos de TMDB son de un tercero, no un 500 propio.
    if (error instanceof TmdbError) {
      return fail(
        "TMDB_ERROR",
        error.message,
        error.status === 404 ? 404 : 502,
      );
    }
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "UNEXPECTED_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    // Los errores del dominio traen código propio y son culpa de la petición;
    // el resto son fallos nuestros y no deben leerse como un 400.
    if (code === "SYNC_ALREADY_RUNNING") return fail(code, message, 409);
    return fail(code, message, code === "UNEXPECTED_ERROR" ? 500 : 400);
  }
}
