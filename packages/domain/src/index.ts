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

  return recalculateAggregate(
    {
      work: aggregate.work,
      entries: aggregate.entries.map((candidate) =>
        candidate.id === entryId ? changed : candidate,
      ),
    },
    now,
  );
}

function nextEntryStatusOrNull(status: EntryStatus): EntryStatus | null {
  return forwardTransitions[status];
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
