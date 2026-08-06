import type { EntryStatus, TmdbType } from "@series-raqui/domain";
import { JobCoordinator } from "@series-raqui/jobs";
import { createServerFn } from "@tanstack/react-start";
import { getContext } from "./context.ts";

export const dashboardFn = createServerFn({ method: "GET" }).handler(() =>
  getContext().app.getDashboard(),
);

export const searchFn = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(({ data }) => getContext().app.searchCatalog(data.query));

export const addWorkFn = createServerFn({ method: "POST" })
  .validator((data: { tmdbType: TmdbType; tmdbId: number }) => data)
  .handler(({ data }) => getContext().app.addWork(data.tmdbType, data.tmdbId));

export const workDetailsFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(({ data }) => getContext().app.getWorkDetails(data.id));

export const transitionFn = createServerFn({ method: "POST" })
  .validator(
    (data: { entryId: string; target: EntryStatus; reason?: string }) => data,
  )
  .handler(({ data }) =>
    getContext().app.transitionEntry(data.entryId, data.target, {
      reason: data.reason,
    }),
  );

export const advanceFn = createServerFn({ method: "POST" })
  .validator((data: { entryId: string }) => data)
  .handler(({ data }) => getContext().app.advanceEntry(data.entryId));

export const updateEntryDetailsFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      entryId: string;
      locations: string[];
      platforms: string[];
      availability: "unknown" | "available" | "unavailable";
    }) => data,
  )
  .handler(({ data }) =>
    getContext().app.updateEntryDetails(data.entryId, data),
  );

export const discardFn = createServerFn({ method: "POST" })
  .validator((data: { workId: string; reason: string }) => data)
  .handler(({ data }) =>
    getContext().app.discardWork(data.workId, data.reason),
  );

export const syncWorkFn = createServerFn({ method: "POST" })
  .validator((data: { workId: string }) => data)
  .handler(({ data }) => getContext().app.syncWork(data.workId));

export const startSyncAllFn = createServerFn({ method: "POST" }).handler(() => {
  const { jobs, config } = getContext();
  if (!config.tmdbAccessToken)
    throw new Error("Falta TMDB_ACCESS_TOKEN en .env.");
  const coordinator = new JobCoordinator(jobs);
  const job = coordinator.create("web");
  try {
    coordinator.launch(job.id);
    const launched = jobs.findById(job.id);
    if (!launched)
      throw new Error("No se pudo recuperar el job recién creado.");
    return launched;
  } catch (error) {
    jobs.finish(
      job.id,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
});

export const activeJobFn = createServerFn({ method: "GET" }).handler(() =>
  getContext().jobs.findActive(),
);

export const jobDetailsFn = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(({ data }) => ({
    job: getContext().jobs.findById(data.id),
    items: getContext().jobs.listItems(data.id),
  }));

export const recentJobsFn = createServerFn({ method: "GET" }).handler(() =>
  getContext().jobs.listRecent(),
);

export const cancelJobFn = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(({ data }) => {
    getContext().jobs.requestCancellation(data.id);
    return getContext().jobs.findById(data.id);
  });

export const validateFn = createServerFn({ method: "GET" }).handler(() =>
  getContext().app.validateLibrary(),
);
