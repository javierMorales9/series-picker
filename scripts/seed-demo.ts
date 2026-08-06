import { loadConfig } from "@series-raqui/config";
import {
  createRepositories,
  migrate,
  openDatabase,
} from "@series-raqui/database";
import { recalculateAggregate, type WorkAggregate } from "@series-raqui/domain";

const { databasePath } = loadConfig();
const db = openDatabase(databasePath);
migrate(db);
const { works } = createRepositories(db);
const now = new Date().toISOString();
const workId = "demo-severance";
const aggregate: WorkAggregate = recalculateAggregate({
  work: {
    id: workId,
    tmdbType: "tv",
    tmdbId: 95396,
    type: "series",
    name: "Separación",
    originalName: "Severance",
    startYear: 2022,
    posterPath: "/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg",
    status: "unplanned",
    currentEntryId: null,
    discardReason: null,
    lastSyncedAt: now,
    syncError: null,
    createdAt: now,
    updatedAt: now,
  },
  entries: [1, 2].map((season) => ({
    id: `demo-severance-${season}`,
    workId,
    tmdbId: 200000 + season,
    type: "season" as const,
    name: `Temporada ${season}`,
    originalName: null,
    position: season,
    seasonNumber: season,
    releaseDate: season === 1 ? "2022-02-18" : "2025-01-16",
    posterPath: null,
    status: season === 1 ? ("watched" as const) : ("unplanned" as const),
    availability: "available" as const,
    locations: [],
    platforms: [],
    lastWatchedAt: season === 1 ? now : null,
    abandonmentReason: null,
    countsTowardsProgress: true,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  })),
});
works.save(aggregate);
console.log(`Datos demo creados en ${databasePath}`);
db.close();
