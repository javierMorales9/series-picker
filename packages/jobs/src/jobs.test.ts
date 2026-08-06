import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExternalWork,
  type MetadataProvider,
  SeriesApplication,
} from "@series-raqui/application";
import {
  createRepositories,
  migrate,
  openDatabase,
} from "@series-raqui/database";
import { JobCoordinator, SyncAllRunner } from "./index.ts";

const metadata: MetadataProvider = {
  search: async () => [],
  posterUrl: (p) => p,
  getWork: async (type, id): Promise<ExternalWork> => ({
    tmdbType: type,
    tmdbId: id,
    type: type === "tv" ? "series" : "movie",
    name: "Test",
    originalName: null,
    startYear: 2020,
    posterPath: null,
    entries:
      type === "tv"
        ? [
            {
              tmdbId: 2,
              type: "season",
              name: "T1",
              originalName: null,
              position: 1,
              seasonNumber: 1,
              releaseDate: "2020-01-01",
              posterPath: null,
              countsTowardsProgress: true,
            },
          ]
        : [
            {
              tmdbId: id,
              type: "movie",
              name: "Test",
              originalName: null,
              position: 1,
              seasonNumber: null,
              releaseDate: "2020-01-01",
              posterPath: null,
              countsTowardsProgress: true,
            },
          ],
  }),
};

describe("jobs", () => {
  test("ejecuta un sync puntual y registra progreso", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepositories(db);
    const app = new SeriesApplication({ ...repos, metadata });
    await app.addWork("tv", 1);
    const job = new JobCoordinator(repos.jobs).create("cli");
    const result = await new SyncAllRunner(app, repos.jobs).run(job.id);
    expect(result.status).toBe("completed");
    expect(result.completedItems).toBe(1);
    expect(repos.jobs.listItems(job.id)).toHaveLength(1);
    db.close();
  });

  test("el launcher ejecuta un proceso puntual mientras vive el servidor", async () => {
    const path = join(tmpdir(), `series-worker-${crypto.randomUUID()}.sqlite`);
    const previousPath = process.env.DATABASE_PATH;
    const previousToken = process.env.TMDB_ACCESS_TOKEN;
    process.env.DATABASE_PATH = path;
    process.env.TMDB_ACCESS_TOKEN = "test-token";
    const db = openDatabase(path);
    migrate(db);
    const repos = createRepositories(db);
    const job = repos.jobs.create("web");
    new JobCoordinator(repos.jobs).launch(job.id);
    let result = repos.jobs.findById(job.id);
    if (!result) throw new Error("El job no se creó.");
    for (
      let i = 0;
      i < 30 && ["pending", "running"].includes(result.status);
      i++
    ) {
      await Bun.sleep(100);
      const current = repos.jobs.findById(job.id);
      if (!current) throw new Error("El job desapareció.");
      result = current;
    }
    expect(result.status).toBe("completed");
    db.close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    if (previousToken === undefined) delete process.env.TMDB_ACCESS_TOKEN;
    else process.env.TMDB_ACCESS_TOKEN = previousToken;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(`${path}${suffix}`);
      } catch {}
    }
  });
});
