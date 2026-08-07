import type {
  Availability,
  Entry,
  EntryStatus,
  OptionKind,
  OptionValue,
  TmdbType,
  Work,
  WorkAggregate,
  WorkStatus,
  WorkType,
} from "@series-raqui/domain";
import {
  discardWork as applyDiscard,
  transitionEntry as applyTransition,
  nextEntryStatus,
  regressEntry as applyRegression,
  recalculateAggregate,
  rewatchWork as applyRewatch,
  validateAggregate,
} from "@series-raqui/domain";

export interface WorkSummary extends Work {
  totalEntries: number;
  watchedEntries: number;
  currentEntryName: string | null;
  nextEntryId: string | null;
  nextEntryName: string | null;
  nextEntryStatus: EntryStatus | null;
  nextEntryLocations: string[];
  nextEntryPlatforms: string[];
  nextEntryAvailability: Entry["availability"] | null;
}

export interface DashboardFilters {
  location?: string;
  platform?: string;
  availability?: Entry["availability"];
}

export interface WorkRepository {
  findById(id: string): WorkAggregate | null;
  findByTmdb(tmdbType: TmdbType, tmdbId: number): WorkAggregate | null;
  list(): WorkAggregate[];
  listSummaries(statuses?: WorkStatus[]): WorkSummary[];
  save(aggregate: WorkAggregate): void;
  deleteAll(): void;
}

export interface OptionRepository {
  list(kind: OptionKind): OptionValue[];
  addMany(kind: OptionKind, values: string[]): void;
  setDefault(kind: OptionKind, value: string | null): void;
}

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface Job {
  id: string;
  type: "sync_all";
  source: "web" | "cli";
  status: JobStatus;
  totalItems: number;
  completedItems: number;
  changedItems: number;
  failedItems: number;
  workerId: string | null;
  workerPid: number | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  cancellationRequestedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface JobItem {
  jobId: string;
  workId: string;
  status: "pending" | "running" | "unchanged" | "changed" | "failed";
  changes: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobRepository {
  create(source: Job["source"]): Job;
  findById(id: string): Job | null;
  findActive(): Job | null;
  listRecent(limit?: number): Job[];
  claim(id: string, workerId: string, workerPid: number): Job;
  heartbeat(id: string): void;
  initializeItems(id: string, workIds: string[]): void;
  startItem(jobId: string, workId: string): void;
  finishItem(
    jobId: string,
    workId: string,
    status: "unchanged" | "changed" | "failed",
    changes?: string[],
    error?: string,
  ): void;
  finish(id: string, status: JobStatus, error?: string): void;
  requestCancellation(id: string): void;
  isCancellationRequested(id: string): boolean;
  interruptStale(staleBefore: string): number;
  listItems(id: string): JobItem[];
}

export interface ExternalWork {
  tmdbType: TmdbType;
  tmdbId: number;
  type: WorkType;
  name: string;
  originalName: string | null;
  startYear: number | null;
  posterPath: string | null;
  entries: ExternalEntry[];
}

export interface ExternalEntry {
  tmdbId: number;
  type: "season" | "movie";
  name: string;
  originalName: string | null;
  position: number;
  seasonNumber: number | null;
  releaseDate: string | null;
  posterPath: string | null;
  countsTowardsProgress: boolean;
}

export interface CatalogResult {
  tmdbType: TmdbType;
  tmdbId: number;
  name: string;
  originalName: string | null;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
}

export interface MetadataProvider {
  search(query: string): Promise<CatalogResult[]>;
  getWork(tmdbType: TmdbType, tmdbId: number): Promise<ExternalWork>;
  posterUrl(path: string | null, size?: string): string | null;
}

export interface ApplicationServices {
  works: WorkRepository;
  jobs: JobRepository;
  options: OptionRepository;
  metadata: MetadataProvider;
}

export interface SyncResult {
  aggregate: WorkAggregate;
  created: boolean;
  changes: string[];
}

export type {
  Availability,
  Entry,
  EntryStatus,
  OptionKind,
  OptionValue,
  Work,
  WorkAggregate,
  WorkStatus,
};

const id = () => crypto.randomUUID();

export class SeriesApplication {
  constructor(private readonly services: ApplicationServices) {}

  searchCatalog(query: string) {
    if (!query.trim()) return Promise.resolve([]);
    return this.services.metadata.search(query.trim());
  }

  async addWork(tmdbType: TmdbType, tmdbId: number): Promise<SyncResult> {
    return this.syncExternal(tmdbType, tmdbId);
  }

  async syncWork(workId: string): Promise<SyncResult> {
    const existing = this.services.works.findById(workId);
    if (!existing)
      throw Object.assign(new Error("No se encontró la Obra."), {
        code: "WORK_NOT_FOUND",
      });
    return this.syncExternal(existing.work.tmdbType, existing.work.tmdbId);
  }

  transitionEntry(
    entryId: string,
    target: EntryStatus,
    options: { reason?: string; force?: boolean; watchedAt?: string } = {},
  ) {
    const aggregate = this.findAggregateByEntry(entryId);
    const changed = applyTransition(aggregate, entryId, target, {
      reason: options.reason,
      force: options.force,
      now: options.watchedAt ?? new Date().toISOString(),
    });
    this.services.works.save(changed);
    return changed;
  }

  advanceEntry(entryId: string) {
    const aggregate = this.findAggregateByEntry(entryId);
    const entry = aggregate.entries.find(
      (candidate) => candidate.id === entryId,
    );
    if (!entry) throw new Error("No se encontró la Entrega.");
    return this.transitionEntry(entryId, nextEntryStatus(entry.status));
  }

  regressEntry(entryId: string) {
    const aggregate = this.findAggregateByEntry(entryId);
    const changed = applyRegression(aggregate, entryId);
    this.services.works.save(changed);
    return changed;
  }

  rewatchWork(workId: string) {
    const aggregate = this.services.works.findById(workId);
    if (!aggregate)
      throw Object.assign(new Error("No se encontró la Obra."), {
        code: "WORK_NOT_FOUND",
      });
    const changed = applyRewatch(aggregate);
    this.services.works.save(changed);
    return changed;
  }

  abandonEntry(entryId: string, reason: string) {
    return this.transitionEntry(entryId, "abandoned", { reason });
  }

  discardWork(workId: string, reason: string) {
    const aggregate = this.services.works.findById(workId);
    if (!aggregate)
      throw Object.assign(new Error("No se encontró la Obra."), {
        code: "WORK_NOT_FOUND",
      });
    const changed = applyDiscard(aggregate, reason);
    this.services.works.save(changed);
    return changed;
  }

  getDashboard(filters: DashboardFilters = {}) {
    const all = this.services.works.listSummaries();
    // Los filtros miran la Entrega que tocaría ver, no todo el historial.
    const matches = (work: WorkSummary) =>
      (!filters.location ||
        work.nextEntryLocations.includes(filters.location)) &&
      (!filters.platform ||
        work.nextEntryPlatforms.includes(filters.platform)) &&
      (!filters.availability ||
        work.nextEntryAvailability === filters.availability);
    const group = (status: WorkStatus) =>
      all.filter((work) => work.status === status && matches(work));
    return {
      all,
      watching: group("watching"),
      selected: group("selected"),
      started: group("started"),
      unplanned: all.filter((work) => work.status === "unplanned"),
    };
  }

  updateEntryDetails(
    entryId: string,
    details: {
      locations?: string[];
      platforms?: string[];
      availability?: Entry["availability"];
    },
  ) {
    const aggregate = this.findAggregateByEntry(entryId);
    const now = new Date().toISOString();
    const changed: WorkAggregate = {
      work: { ...aggregate.work, updatedAt: now },
      entries: aggregate.entries.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              locations: details.locations ?? entry.locations,
              platforms: details.platforms ?? entry.platforms,
              availability: details.availability ?? entry.availability,
              updatedAt: now,
            }
          : entry,
      ),
    };
    this.services.works.save(changed);
    this.services.options.addMany("location", details.locations ?? []);
    this.services.options.addMany("platform", details.platforms ?? []);
    return changed;
  }

  listOptionValues() {
    return {
      locations: this.services.options.list("location"),
      platforms: this.services.options.list("platform"),
    };
  }

  setDefaultOptionValue(kind: OptionKind, value: string | null) {
    if (value) this.services.options.addMany(kind, [value]);
    this.services.options.setDefault(kind, value);
    return this.listOptionValues();
  }

  listWorks() {
    return this.services.works.list();
  }

  getWorkDetails(id: string) {
    const aggregate = this.services.works.findById(id);
    if (!aggregate)
      throw Object.assign(new Error("No se encontró la Obra."), {
        code: "WORK_NOT_FOUND",
      });
    return aggregate;
  }

  validateLibrary() {
    return this.services.works.list().flatMap((aggregate) =>
      validateAggregate(aggregate).map((error) => ({
        workId: aggregate.work.id,
        code: error.code,
        message: error.message,
      })),
    );
  }

  private async syncExternal(
    tmdbType: TmdbType,
    tmdbId: number,
  ): Promise<SyncResult> {
    const external = await this.services.metadata.getWork(tmdbType, tmdbId);
    const existing = this.services.works.findByTmdb(tmdbType, tmdbId);
    const now = new Date().toISOString();
    const changes: string[] = [];
    const workId = existing?.work.id ?? id();

    const work: Work = {
      id: workId,
      tmdbType: external.tmdbType,
      tmdbId: external.tmdbId,
      type: external.type,
      name: external.name,
      originalName: external.originalName,
      startYear: external.startYear,
      posterPath: external.posterPath,
      status: existing?.work.status ?? "unplanned",
      currentEntryId: existing?.work.currentEntryId ?? null,
      discardReason: existing?.work.discardReason ?? null,
      lastSyncedAt: now,
      syncError: null,
      createdAt: existing?.work.createdAt ?? now,
      updatedAt: now,
    };
    if (!existing) changes.push("Obra creada");
    else if (
      existing.work.name !== external.name ||
      existing.work.posterPath !== external.posterPath
    )
      changes.push("Metadatos actualizados");

    const existingByKey = new Map(
      existing?.entries.map((entry) => [
        `${entry.type}:${entry.tmdbId}`,
        entry,
      ]) ?? [],
    );
    const defaultOf = (kind: OptionKind) => {
      const value = this.services.options
        .list(kind)
        .find((option) => option.isDefault)?.value;
      return value ? [value] : [];
    };
    const defaultLocations = defaultOf("location");
    const defaultPlatforms = defaultOf("platform");
    const entries: Entry[] = external.entries.map((externalEntry) => {
      const previous = existingByKey.get(
        `${externalEntry.type}:${externalEntry.tmdbId}`,
      );
      if (!previous) changes.push(`Entrega añadida: ${externalEntry.name}`);
      return {
        id: previous?.id ?? id(),
        workId,
        tmdbId: externalEntry.tmdbId,
        type: externalEntry.type,
        name: externalEntry.name,
        originalName: externalEntry.originalName,
        position: externalEntry.position,
        seasonNumber: externalEntry.seasonNumber,
        releaseDate: externalEntry.releaseDate,
        posterPath: externalEntry.posterPath,
        status: previous?.status ?? "unplanned",
        availability: previous?.availability ?? "available",
        locations: previous?.locations ?? defaultLocations,
        platforms: previous?.platforms ?? defaultPlatforms,
        lastWatchedAt: previous?.lastWatchedAt ?? null,
        abandonmentReason: previous?.abandonmentReason ?? null,
        countsTowardsProgress: externalEntry.countsTowardsProgress,
        lastSyncedAt: now,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
    });
    for (const previous of existing?.entries ?? []) {
      if (
        !external.entries.some(
          (entry) =>
            entry.type === previous.type && entry.tmdbId === previous.tmdbId,
        )
      )
        entries.push(previous);
    }
    const aggregate = recalculateAggregate({ work, entries }, now);
    this.services.works.save(aggregate);
    return { aggregate, created: !existing, changes };
  }

  private findAggregateByEntry(entryId: string): WorkAggregate {
    const aggregate = this.services.works
      .list()
      .find((candidate) =>
        candidate.entries.some((entry) => entry.id === entryId),
      );
    if (!aggregate)
      throw Object.assign(new Error("No se encontró la Entrega."), {
        code: "ENTRY_NOT_FOUND",
      });
    return aggregate;
  }
}
