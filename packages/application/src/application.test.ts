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

  test("el panel apunta a la entrega accionable y filtra por lugar", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepositories(db);
    const metadata = new FakeMetadata();
    metadata.version = 2;
    const app = new SeriesApplication({ ...repos, metadata });
    const { aggregate } = await app.addWork("tv", 1);
    const [first, second] = aggregate.entries;
    if (!first || !second) throw new Error("Faltan temporadas.");

    // Sin empezar: la entrega accionable es la primera, aún por seleccionar.
    const fresh = app.getDashboard().unplanned[0];
    expect(fresh?.nextEntryId).toBe(first.id);
    expect(fresh?.nextEntryStatus).toBe("unplanned");

    app.transitionEntry(first.id, "watched", { force: true });
    app.updateEntryDetails(second.id, {
      locations: ["Salón"],
      platforms: ["Netflix"],
    });

    // Empezada: apunta a la siguiente temporada, no a la ya vista.
    const started = app.getDashboard().selected[0];
    expect(started?.nextEntryId).toBe(second.id);
    expect(started?.nextEntryStatus).toBe("selected");

    expect(app.getDashboard({ location: "Salón" }).selected).toHaveLength(1);
    expect(app.getDashboard({ location: "Cine" }).selected).toHaveLength(0);
    expect(app.getDashboard({ platform: "Netflix" }).selected).toHaveLength(1);
    expect(
      app.getDashboard({ location: "Salón", platform: "HBO" }).selected,
    ).toHaveLength(0);

    // Obra empezada: la entrega actual ya está vista, así que la accionable
    // debe ser la siguiente pendiente y no la que acaba de terminar.
    app.transitionEntry(second.id, "watched", { force: true });
    const completed = app.getDashboard().all.find((w) => w.id === first.workId);
    expect(completed?.nextEntryStatus).toBe("watched");
    db.close();
  });

  test("la entrega accionable de una obra empezada es la pendiente", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepositories(db);
    const metadata = new FakeMetadata();
    const app = new SeriesApplication({ ...repos, metadata });
    const created = await app.addWork("tv", 1);
    const only = created.aggregate.entries[0];
    if (!only) throw new Error("Falta la temporada inicial.");
    app.transitionEntry(only.id, "watched", { force: true });
    expect(app.getDashboard().all[0]?.status).toBe("completed");

    // Llega una temporada nueva: la obra pasa a "started" y la accionable
    // debe ser la temporada nueva, no la ya vista.
    metadata.version = 2;
    const synced = await app.syncWork(created.aggregate.work.id);
    const fresh = synced.aggregate.entries.find((e) => e.id !== only.id);
    const summary = app.getDashboard().started[0];
    expect(summary?.nextEntryId).toBe(fresh?.id);
    expect(summary?.nextEntryStatus).toBe("unplanned");
    db.close();
  });

  test("aplica la opción por defecto a las entregas nuevas", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepositories(db);
    const metadata = new FakeMetadata();
    const app = new SeriesApplication({ ...repos, metadata });
    app.setDefaultOptionValue("location", "Salón");
    app.setDefaultOptionValue("platform", "Disney+");

    const created = await app.addWork("tv", 1);
    const entry = created.aggregate.entries[0];
    if (!entry) throw new Error("La temporada inicial no se creó.");
    expect(entry.locations).toEqual(["Salón"]);
    expect(entry.platforms).toEqual(["Disney+"]);

    app.updateEntryDetails(entry.id, { locations: ["Cine"], platforms: [] });
    const values = app.listOptionValues();
    expect(values.locations).toEqual([
      { value: "Cine", isDefault: false },
      { value: "Salón", isDefault: true },
    ]);

    // Las entregas ya existentes conservan lo suyo aunque cambie el defecto.
    metadata.version = 2;
    const synced = await app.syncWork(created.aggregate.work.id);
    expect(
      synced.aggregate.entries.find((e) => e.id === entry.id)?.locations,
    ).toEqual(["Cine"]);
    expect(
      synced.aggregate.entries.find((e) => e.id !== entry.id)?.locations,
    ).toEqual(["Salón"]);
    db.close();
  });
});
