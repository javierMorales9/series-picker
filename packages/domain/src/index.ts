export type WorkType = "series" | "movie";
export type TmdbType = "tv" | "movie";
export type EntryType = "season" | "movie";
export type EntryStatus =
  | "unplanned"
  | "selected"
  | "ready"
  | "watching"
  | "watched"
  | "abandoned";
export type WorkStatus =
  | "unplanned"
  | "selected"
  | "watching"
  | "started"
  | "completed"
  | "abandoned"
  | "discarded";
export type Availability = "unknown" | "available" | "unavailable";
export type OptionKind = "location" | "platform";

export interface OptionValue {
  value: string;
  isDefault: boolean;
}

export interface Work {
  id: string;
  tmdbType: TmdbType;
  tmdbId: number;
  type: WorkType;
  name: string;
  originalName: string | null;
  startYear: number | null;
  posterPath: string | null;
  status: WorkStatus;
  currentEntryId: string | null;
  discardReason: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  workId: string;
  tmdbId: number;
  type: EntryType;
  name: string;
  originalName: string | null;
  position: number;
  seasonNumber: number | null;
  releaseDate: string | null;
  posterPath: string | null;
  status: EntryStatus;
  availability: Availability;
  locations: string[];
  platforms: string[];
  lastWatchedAt: string | null;
  abandonmentReason: string | null;
  countsTowardsProgress: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkAggregate {
  work: Work;
  entries: Entry[];
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const forwardTransitions: Record<EntryStatus, EntryStatus | null> = {
  unplanned: "selected",
  selected: "ready",
  ready: "watching",
  watching: "watched",
  watched: null,
  abandoned: null,
};

const backwardTransitions: Record<EntryStatus, EntryStatus | null> = {
  unplanned: null,
  selected: "unplanned",
  ready: "selected",
  watching: "ready",
  watched: "watching",
  abandoned: "watching",
};

export function nextEntryStatus(status: EntryStatus): EntryStatus {
  const next = forwardTransitions[status];
  if (!next) {
    throw new DomainError(
      "ENTRY_HAS_NO_NEXT_STATUS",
      `No hay un estado posterior para ${status}.`,
    );
  }
  return next;
}

export function previousEntryStatus(status: EntryStatus): EntryStatus {
  const previous = backwardTransitions[status];
  if (!previous) {
    throw new DomainError(
      "ENTRY_HAS_NO_PREVIOUS_STATUS",
      `No hay un estado anterior para ${status}.`,
    );
  }
  return previous;
}

export interface TransitionOptions {
  now?: string;
  reason?: string;
  force?: boolean;
}

export function transitionEntry(
  aggregate: WorkAggregate,
  entryId: string,
  target: EntryStatus,
  options: TransitionOptions = {},
): WorkAggregate {
  const now = options.now ?? new Date().toISOString();
  const entry = aggregate.entries.find((candidate) => candidate.id === entryId);
  if (!entry)
    throw new DomainError("ENTRY_NOT_FOUND", "No se encontró la Entrega.");

  if (entry.status === target) return recalculateAggregate(aggregate, now);

  if (!options.force && target !== nextEntryStatusOrNull(entry.status)) {
    if (!(target === "abandoned" && entry.status === "watching")) {
      throw new DomainError(
        "INVALID_ENTRY_TRANSITION",
        `No se puede pasar de ${entry.status} a ${target}.`,
      );
    }
  }

  if (target === "watching") {
    const anotherWatching = aggregate.entries.some(
      (candidate) =>
        candidate.id !== entryId && candidate.status === "watching",
    );
    if (anotherWatching) {
      throw new DomainError(
        "WORK_ALREADY_WATCHING",
        "Ya hay otra Entrega en curso para esta Obra.",
      );
    }
  }

  if (target === "abandoned" && !options.reason?.trim()) {
    throw new DomainError(
      "ABANDONMENT_REASON_REQUIRED",
      "El abandono requiere un motivo.",
    );
  }

  const changed: Entry = {
    ...entry,
    status: target,
    lastWatchedAt: target === "watched" ? now : entry.lastWatchedAt,
    abandonmentReason:
      target === "abandoned" ? (options.reason?.trim() ?? null) : null,
    updatedAt: now,
  };

  const entries = aggregate.entries.map((candidate) =>
    candidate.id === entryId ? changed : candidate,
  );
  const selectedNext =
    target === "watched" ? selectNextUnplannedEntry(entries, changed) : entries;

  return recalculateAggregate(
    {
      work: aggregate.work,
      entries: selectedNext,
    },
    now,
  );
}

function nextEntryStatusOrNull(status: EntryStatus): EntryStatus | null {
  return forwardTransitions[status];
}

function selectNextUnplannedEntry(entries: Entry[], watched: Entry): Entry[] {
  if (!watched.countsTowardsProgress) return entries;
  const next = entries
    .filter(
      (entry) =>
        entry.workId === watched.workId &&
        entry.countsTowardsProgress &&
        entry.position > watched.position,
    )
    .sort((a, b) => a.position - b.position)[0];
  if (!next || next.status !== "unplanned") return entries;
  return entries.map((entry) =>
    entry.id === next.id
      ? { ...entry, status: "selected", updatedAt: watched.updatedAt }
      : entry,
  );
}

export function regressEntry(
  aggregate: WorkAggregate,
  entryId: string,
  now = new Date().toISOString(),
): WorkAggregate {
  const entry = aggregate.entries.find((candidate) => candidate.id === entryId);
  if (!entry)
    throw new DomainError("ENTRY_NOT_FOUND", "No se encontró la Entrega.");
  return transitionEntry(aggregate, entryId, previousEntryStatus(entry.status), {
    force: true,
    now,
  });
}

export function rewatchWork(
  aggregate: WorkAggregate,
  now = new Date().toISOString(),
): WorkAggregate {
  const counted = aggregate.entries
    .filter((entry) => entry.countsTowardsProgress)
    .sort((a, b) => a.position - b.position);
  if (counted.length === 0) {
    throw new DomainError(
      "WORK_HAS_NO_PROGRESS_ENTRIES",
      "La Obra no tiene Entregas que cuenten para progreso.",
    );
  }
  if (!counted.every((entry) => entry.status === "watched")) {
    throw new DomainError(
      "WORK_IS_NOT_COMPLETED",
      "Solo se puede volver a ver una Obra finalizada.",
    );
  }
  const first = counted[0];
  if (!first) {
    throw new DomainError(
      "WORK_HAS_NO_PROGRESS_ENTRIES",
      "La Obra no tiene Entregas que cuenten para progreso.",
    );
  }
  return recalculateAggregate(
    {
      work: { ...aggregate.work, discardReason: null, updatedAt: now },
      entries: aggregate.entries.map((entry) =>
        entry.countsTowardsProgress
          ? {
              ...entry,
              status: entry.id === first.id ? "selected" : "unplanned",
              abandonmentReason: null,
              updatedAt: now,
            }
          : entry,
      ),
    },
    now,
  );
}

export function discardWork(
  aggregate: WorkAggregate,
  reason: string,
  now = new Date().toISOString(),
): WorkAggregate {
  if (!reason.trim())
    throw new DomainError(
      "DISCARD_REASON_REQUIRED",
      "El descarte requiere un motivo.",
    );
  if (
    aggregate.entries.some((entry) =>
      ["watching", "watched", "abandoned"].includes(entry.status),
    )
  ) {
    throw new DomainError(
      "WORK_ALREADY_STARTED",
      "No se puede descartar una Obra que ya se ha empezado.",
    );
  }
  return recalculateAggregate(
    {
      work: { ...aggregate.work, discardReason: reason.trim(), updatedAt: now },
      entries: aggregate.entries,
    },
    now,
  );
}

export function calculateWorkStatus(work: Work, entries: Entry[]): WorkStatus {
  const counted = entries.filter((entry) => entry.countsTowardsProgress);
  if (work.discardReason) return "discarded";
  if (counted.some((entry) => entry.status === "abandoned")) return "abandoned";
  if (counted.some((entry) => entry.status === "watching")) return "watching";
  if (
    counted.some(
      (entry) => entry.status === "selected" || entry.status === "ready",
    )
  )
    return "selected";
  if (
    counted.length > 0 &&
    counted.every((entry) => entry.status === "watched")
  )
    return "completed";
  if (counted.some((entry) => entry.status === "watched")) return "started";
  return "unplanned";
}

export function calculateCurrentEntry(entries: Entry[]): Entry | null {
  const counted = entries.filter((entry) => entry.countsTowardsProgress);
  const byPosition = (a: Entry, b: Entry) => a.position - b.position;
  const abandoned = counted
    .filter((entry) => entry.status === "abandoned")
    .sort(byPosition)
    .at(-1);
  if (abandoned) return abandoned;
  const watching = counted.find((entry) => entry.status === "watching");
  if (watching) return watching;
  const ready = counted
    .filter((entry) => entry.status === "ready")
    .sort(byPosition)[0];
  if (ready) return ready;
  const selected = counted
    .filter((entry) => entry.status === "selected")
    .sort(byPosition)[0];
  if (selected) return selected;
  return (
    counted
      .filter((entry) => entry.status === "watched")
      .sort(byPosition)
      .at(-1) ?? null
  );
}

export function recalculateAggregate(
  aggregate: WorkAggregate,
  now = new Date().toISOString(),
): WorkAggregate {
  const status = calculateWorkStatus(aggregate.work, aggregate.entries);
  const current = calculateCurrentEntry(aggregate.entries);
  return {
    work: {
      ...aggregate.work,
      status,
      currentEntryId: current?.id ?? null,
      updatedAt: now,
    },
    entries: aggregate.entries,
  };
}

export function validateAggregate(aggregate: WorkAggregate): DomainError[] {
  const errors: DomainError[] = [];
  if (aggregate.entries.some((entry) => entry.workId !== aggregate.work.id)) {
    errors.push(
      new DomainError(
        "ENTRY_WORK_MISMATCH",
        "Hay Entregas asociadas a otra Obra.",
      ),
    );
  }
  if (
    aggregate.entries.filter((entry) => entry.status === "watching").length > 1
  ) {
    errors.push(
      new DomainError(
        "MULTIPLE_WATCHING_ENTRIES",
        "Hay más de una Entrega en curso.",
      ),
    );
  }
  for (const entry of aggregate.entries) {
    if (entry.status === "abandoned" && !entry.abandonmentReason) {
      errors.push(
        new DomainError(
          "ABANDONMENT_REASON_REQUIRED",
          `Falta motivo en ${entry.name}.`,
        ),
      );
    }
  }
  if (
    calculateWorkStatus(aggregate.work, aggregate.entries) !==
    aggregate.work.status
  ) {
    errors.push(
      new DomainError(
        "WORK_STATUS_MISMATCH",
        "El Estado persistido de la Obra no coincide.",
      ),
    );
  }
  if (
    (calculateCurrentEntry(aggregate.entries)?.id ?? null) !==
    aggregate.work.currentEntryId
  ) {
    errors.push(
      new DomainError(
        "CURRENT_ENTRY_MISMATCH",
        "La Entrega actual persistida no coincide.",
      ),
    );
  }
  return errors;
}
