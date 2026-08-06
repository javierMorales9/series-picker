import { describe, expect, test } from "bun:test";
import {
  createRepositories,
  migrate,
  openDatabase,
} from "@series-raqui/database";
import {
  type ExternalWork,
  type MetadataProvider,
  SeriesApplication,
} from "./index.ts";

class FakeMetadata implements MetadataProvider {
  version = 1;
  async search() {
    return [];
  }
  posterUrl(path: string | null) {
    return path;
  }
  async getWork(): Promise<ExternalWork> {
    return {
      tmdbType: "tv",
      tmdbId: 1,
      type: "series",
      name: "Serie",
      originalName: "Show",
      startYear: 2020,
      posterPath: "/poster.jpg",
      entries: [
        {
          tmdbId: 11,
          type: "season",
          name: "T1",
          originalName: null,
          position: 1,
          seasonNumber: 1,
          releaseDate: "2020-01-01",
          posterPath: null,
          countsTowardsProgress: true,
        },
        ...(this.version > 1
          ? [
              {
                tmdbId: 12,
                type: "season" as const,
                name: "T2",
                originalName: null,
                position: 2,
                seasonNumber: 2,
                releaseDate: "2026-01-01",
                posterPath: null,
                countsTowardsProgress: true,
              },
            ]
          : []),
      ],
    };
  }
}

describe("casos de uso", () => {
  test("upsert conserva progreso y añade temporadas", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepositories(db);
    const metadata = new FakeMetadata();
    const app = new SeriesApplication({ ...repos, metadata });
    const first = await app.addWork("tv", 1);
    const firstEntry = first.aggregate.entries[0];
    if (!firstEntry) throw new Error("La temporada inicial no se creó.");
    const entryId = firstEntry.id;
    app.transitionEntry(entryId, "watched", {
      force: true,
      watchedAt: "2026-08-05T00:00:00Z",
    });
    metadata.version = 2;
    const second = await app.addWork("tv", 1);
    expect(second.created).toBe(false);
    expect(second.aggregate.entries).toHaveLength(2);
    expect(second.aggregate.entries.find((e) => e.id === entryId)?.status).toBe(
      "watched",
    );
    expect(second.aggregate.work.status).toBe("started");
    db.close();
  });
});
