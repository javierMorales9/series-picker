import { describe, expect, test } from "bun:test";
import {
  calculateWorkStatus,
  discardWork,
  type Entry,
  nextEntryStatus,
  regressEntry,
  rewatchWork,
  transitionEntry,
  type Work,
  type WorkAggregate,
} from "./index.ts";

const now = "2026-08-05T10:00:00.000Z";
const work: Work = {
  id: "w1",
  tmdbType: "tv",
  tmdbId: 1,
  type: "series",
  name: "Serie",
  originalName: null,
  startYear: 2024,
  posterPath: null,
  status: "unplanned",
  currentEntryId: null,
  discardReason: null,
  lastSyncedAt: null,
  syncError: null,
  createdAt: now,
  updatedAt: now,
};
const entry = (
  id: string,
  position: number,
  status: Entry["status"] = "unplanned",
): Entry => ({
  id,
  workId: "w1",
  tmdbId: position,
  type: "season",
  name: `T${position}`,
  originalName: null,
  position,
  seasonNumber: position,
  releaseDate: "2024-01-01",
  posterPath: null,
  status,
  availability: "available",
  locations: [],
  platforms: [],
  lastWatchedAt: null,
  abandonmentReason: null,
  countsTowardsProgress: true,
  lastSyncedAt: null,
  createdAt: now,
  updatedAt: now,
});
const aggregate = (entries: Entry[]): WorkAggregate => ({ work, entries });

describe("dominio", () => {
  test("recorre el flujo principal", () => {
    expect(nextEntryStatus("unplanned")).toBe("selected");
    let value = transitionEntry(aggregate([entry("e1", 1)]), "e1", "selected", {
      now,
    });
    value = transitionEntry(value, "e1", "ready", { now });
    value = transitionEntry(value, "e1", "watching", { now });
    value = transitionEntry(value, "e1", "watched", { now });
    expect(value.work.status).toBe("completed");
    expect(value.entries[0]?.lastWatchedAt).toBe(now);
  });

  test("calcula precedencia", () => {
    expect(
      calculateWorkStatus(work, [entry("e1", 1, "watched"), entry("e2", 2)]),
    ).toBe("started");
    expect(
      calculateWorkStatus(work, [
        entry("e1", 1, "watched"),
        entry("e2", 2, "selected"),
      ]),
    ).toBe("selected");
    expect(calculateWorkStatus(work, [entry("e1", 1, "abandoned")])).toBe(
      "abandoned",
    );
  });

  test("solo permite una entrega viendo", () => {
    expect(() =>
      transitionEntry(
        aggregate([entry("e1", 1, "watching"), entry("e2", 2, "ready")]),
        "e2",
        "watching",
      ),
    ).toThrow();
  });

  test("marca la siguiente entrega como seleccionada al terminar una temporada", () => {
    const value = transitionEntry(
      aggregate([entry("e1", 1, "watching"), entry("e2", 2)]),
      "e1",
      "watched",
      { now },
    );
    expect(value.entries.find((candidate) => candidate.id === "e1")?.status).toBe(
      "watched",
    );
    expect(value.entries.find((candidate) => candidate.id === "e2")?.status).toBe(
      "selected",
    );
    expect(value.work.currentEntryId).toBe("e2");
  });

  test("permite volver un paso atrás sin borrar la última fecha vista", () => {
    const value = regressEntry(
      aggregate([{ ...entry("e1", 1, "watched"), lastWatchedAt: now }]),
      "e1",
      "2026-08-06T10:00:00.000Z",
    );
    expect(value.entries[0]?.status).toBe("watching");
    expect(value.entries[0]?.lastWatchedAt).toBe(now);
  });

  test("volver a ver reinicia una obra finalizada como seleccionada", () => {
    const value = rewatchWork(
      aggregate([
        { ...entry("e1", 1, "watched"), lastWatchedAt: now },
        { ...entry("e2", 2, "watched"), lastWatchedAt: now },
      ]),
      "2026-08-06T10:00:00.000Z",
    );
    expect(value.entries.map((candidate) => candidate.status)).toEqual([
      "selected",
      "unplanned",
    ]);
    expect(value.entries.map((candidate) => candidate.lastWatchedAt)).toEqual([
      now,
      now,
    ]);
    expect(value.work.status).toBe("selected");
  });

  test("no descarta una obra empezada", () => {
    expect(() =>
      discardWork(aggregate([entry("e1", 1, "watched")]), "No me gusta"),
    ).toThrow();
  });
});
