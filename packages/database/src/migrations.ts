import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE works (
        id TEXT PRIMARY KEY,
        tmdb_type TEXT NOT NULL CHECK (tmdb_type IN ('tv','movie')),
        tmdb_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('series','movie')),
        name TEXT NOT NULL,
        original_name TEXT,
        start_year INTEGER,
        poster_path TEXT,
        status TEXT NOT NULL CHECK (status IN ('unplanned','selected','watching','started','completed','abandoned','discarded')),
        current_entry_id TEXT,
        discard_reason TEXT,
        last_synced_at TEXT,
        sync_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tmdb_type, tmdb_id)
      );

      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        tmdb_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('season','movie')),
        name TEXT NOT NULL,
        original_name TEXT,
        position INTEGER NOT NULL,
        season_number INTEGER,
        release_date TEXT,
        poster_path TEXT,
        status TEXT NOT NULL CHECK (status IN ('unplanned','selected','ready','watching','watched','abandoned')),
        availability TEXT NOT NULL CHECK (availability IN ('unknown','available','unavailable')),
        locations TEXT NOT NULL DEFAULT '[]',
        platforms TEXT NOT NULL DEFAULT '[]',
        last_watched_at TEXT,
        abandonment_reason TEXT,
        counts_towards_progress INTEGER NOT NULL DEFAULT 1 CHECK (counts_towards_progress IN (0,1)),
        last_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (work_id, type, tmdb_id)
      );

      CREATE INDEX entries_work_position ON entries(work_id, position);
      CREATE INDEX entries_status ON entries(status);
      CREATE INDEX entries_release_date ON entries(release_date);
      CREATE INDEX works_status ON works(status);

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('sync_all')),
        source TEXT NOT NULL CHECK (source IN ('web','cli')),
        status TEXT NOT NULL CHECK (status IN ('pending','running','completed','completed_with_errors','failed','cancelled','interrupted')),
        total_items INTEGER NOT NULL DEFAULT 0,
        completed_items INTEGER NOT NULL DEFAULT 0,
        changed_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        worker_id TEXT,
        worker_pid INTEGER,
        created_at TEXT NOT NULL,
        started_at TEXT,
        heartbeat_at TEXT,
        cancellation_requested_at TEXT,
        finished_at TEXT,
        error TEXT
      );

      CREATE UNIQUE INDEX only_one_active_sync_all
      ON jobs(type)
      WHERE type = 'sync_all' AND status IN ('pending','running');

      CREATE INDEX jobs_created_at ON jobs(created_at DESC);

      CREATE TABLE job_items (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending','running','unchanged','changed','failed')),
        changes TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        PRIMARY KEY (job_id, work_id)
      );
    `,
  },
];

export function migrate(db: Database): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (
      db.query("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>
    ).map((row) => row.version),
  );
  const newlyApplied: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.query(
        "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
      ).run(migration.version, migration.name, new Date().toISOString());
    })();
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
