import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkAggregate } from "@series-raqui/domain";
import { createRepositories, migrate, openDatabase } from "./index.ts";

const files: string[] = [];
afterEach(() => {
  for (const file of files.splice(0)) {
    try {
      unlinkSync(file);
    } catch {}
  }
});

function setup() {
  const file = join(tmpdir(), `series-${crypto.randomUUID()}.sqlite`);
  files.push(file, `${file}-wal`, `${file}-shm`);
  const db = openDatabase(file);
  migrate(db);
  return { db, ...createRepositories(db) };
}

function fixture(): WorkAggregate {
  const now = new Date().toISOString();
  return {
    work: {
      id: "w",
      tmdbType: "tv",
      tmdbId: 1,
      type: "series",
      name: "Test",
      originalName: null,
      startYear: 2020,
      posterPath: null,
      status: "unplanned",
      currentEntryId: null,
      discardReason: null,
      lastSyncedAt: now,
      syncError: null,
      createdAt: now,
      updatedAt: now,
    },
    entries: [
      {
        id: "e",
        workId: "w",
        tmdbId: 10,
        type: "season",
        name: "T1",
        originalName: null,
        position: 1,
        seasonNumber: 1,
        releaseDate: "2020-01-01",
        posterPath: null,
        status: "unplanned",
        availability: "available",
        locations: [],
        platforms: [],
        lastWatchedAt: null,
        abandonmentReason: null,
        countsTowardsProgress: true,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

describe("SQLite", () => {
  test("migra de forma idempotente y persiste agregados", () => {
    const { db, works } = setup();
    expect(migrate(db)).toEqual([]);
    works.save(fixture());
    expect(works.findByTmdb("tv", 1)?.entries).toHaveLength(1);
    db.close();
  });

  test("impide dos syncs activos", () => {
    const { db, jobs } = setup();
    jobs.create("cli");
    expect(() => jobs.create("web")).toThrow();
    db.close();
  });

  test("interrumpe jobs con heartbeat caducado y admite cancelación", () => {
    const { db, jobs } = setup();
    const job = jobs.create("web");
    db.query(
      "UPDATE jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    ).run(job.id);
    expect(jobs.interruptStale("2001-01-01T00:00:00.000Z")).toBe(1);
    const next = jobs.create("cli");
    jobs.requestCancellation(next.id);
    expect(jobs.isCancellationRequested(next.id)).toBe(true);
    db.close();
  });
});
