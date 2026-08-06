import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Job,
  JobItem,
  JobRepository,
  JobStatus,
  WorkRepository,
  WorkSummary,
} from "@series-raqui/application";
import type { Entry, Work, WorkAggregate } from "@series-raqui/domain";
import { migrate, migrations } from "./migrations.ts";

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export { migrate, migrations };

const parseArray = (value: string): string[] => {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
};

function mapWork(row: any): Work {
  return {
    id: row.id,
    tmdbType: row.tmdb_type,
    tmdbId: row.tmdb_id,
    type: row.type,
    name: row.name,
    originalName: row.original_name,
    startYear: row.start_year,
    posterPath: row.poster_path,
    status: row.status,
    currentEntryId: row.current_entry_id,
    discardReason: row.discard_reason,
    lastSyncedAt: row.last_synced_at,
    syncError: row.sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntry(row: any): Entry {
  return {
    id: row.id,
    workId: row.work_id,
    tmdbId: row.tmdb_id,
    type: row.type,
    name: row.name,
    originalName: row.original_name,
    position: row.position,
    seasonNumber: row.season_number,
    releaseDate: row.release_date,
    posterPath: row.poster_path,
    status: row.status,
    availability: row.availability,
    locations: parseArray(row.locations),
    platforms: parseArray(row.platforms),
    lastWatchedAt: row.last_watched_at,
    abandonmentReason: row.abandonment_reason,
    countsTowardsProgress: Boolean(row.counts_towards_progress),
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteWorkRepository implements WorkRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): WorkAggregate | null {
    const row = this.db.query("SELECT * FROM works WHERE id = ?").get(id);
    return row ? this.aggregate(mapWork(row)) : null;
  }
  findByTmdb(tmdbType: Work["tmdbType"], tmdbId: number): WorkAggregate | null {
    const row = this.db
      .query("SELECT * FROM works WHERE tmdb_type = ? AND tmdb_id = ?")
      .get(tmdbType, tmdbId);
    return row ? this.aggregate(mapWork(row)) : null;
  }
  list(): WorkAggregate[] {
    return (
      this.db
        .query("SELECT * FROM works ORDER BY name COLLATE NOCASE")
        .all() as any[]
    ).map((row) => this.aggregate(mapWork(row)));
  }
  listSummaries(statuses?: Work["status"][]): WorkSummary[] {
    const rows = this.db
      .query(`
      SELECT w.*,
        COUNT(CASE WHEN e.counts_towards_progress = 1 THEN 1 END) total_entries,
        COUNT(CASE WHEN e.counts_towards_progress = 1 AND e.status = 'watched' THEN 1 END) watched_entries,
        ce.name current_entry_name
      FROM works w
      LEFT JOIN entries e ON e.work_id = w.id
      LEFT JOIN entries ce ON ce.id = w.current_entry_id
      GROUP BY w.id
      ORDER BY w.updated_at DESC
    `)
      .all() as any[];
    return rows
      .filter((row) => !statuses?.length || statuses.includes(row.status))
      .map((row) => ({
        ...mapWork(row),
        totalEntries: row.total_entries,
        watchedEntries: row.watched_entries,
        currentEntryName: row.current_entry_name,
      }));
  }
  save(aggregate: WorkAggregate): void {
    this.db.transaction(() => {
      const w = aggregate.work;
      this.db
        .query(`INSERT INTO works VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET tmdb_type=excluded.tmdb_type,tmdb_id=excluded.tmdb_id,type=excluded.type,
        name=excluded.name,original_name=excluded.original_name,start_year=excluded.start_year,poster_path=excluded.poster_path,
        status=excluded.status,current_entry_id=excluded.current_entry_id,discard_reason=excluded.discard_reason,
        last_synced_at=excluded.last_synced_at,sync_error=excluded.sync_error,updated_at=excluded.updated_at`)
        .run(
          w.id,
          w.tmdbType,
          w.tmdbId,
          w.type,
          w.name,
          w.originalName,
          w.startYear,
          w.posterPath,
          w.status,
          w.currentEntryId,
          w.discardReason,
          w.lastSyncedAt,
          w.syncError,
          w.createdAt,
          w.updatedAt,
        );
      for (const e of aggregate.entries) {
        this.db
          .query(`INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,original_name=excluded.original_name,position=excluded.position,
          season_number=excluded.season_number,release_date=excluded.release_date,poster_path=excluded.poster_path,
          status=excluded.status,availability=excluded.availability,locations=excluded.locations,platforms=excluded.platforms,
          last_watched_at=excluded.last_watched_at,abandonment_reason=excluded.abandonment_reason,
          counts_towards_progress=excluded.counts_towards_progress,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at`)
          .run(
            e.id,
            e.workId,
            e.tmdbId,
            e.type,
            e.name,
            e.originalName,
            e.position,
            e.seasonNumber,
            e.releaseDate,
            e.posterPath,
            e.status,
            e.availability,
            JSON.stringify(e.locations),
            JSON.stringify(e.platforms),
            e.lastWatchedAt,
            e.abandonmentReason,
            e.countsTowardsProgress ? 1 : 0,
            e.lastSyncedAt,
            e.createdAt,
            e.updatedAt,
          );
      }
    })();
  }
  deleteAll(): void {
    this.db.exec("DELETE FROM entries; DELETE FROM works;");
  }
  private aggregate(work: Work): WorkAggregate {
    const entries = (
      this.db
        .query("SELECT * FROM entries WHERE work_id = ? ORDER BY position")
        .all(work.id) as any[]
    ).map(mapEntry);
    return { work, entries };
  }
}

const mapJob = (row: any): Job => ({
  id: row.id,
  type: row.type,
  source: row.source,
  status: row.status,
  totalItems: row.total_items,
  completedItems: row.completed_items,
  changedItems: row.changed_items,
  failedItems: row.failed_items,
  workerId: row.worker_id,
  workerPid: row.worker_pid,
  createdAt: row.created_at,
  startedAt: row.started_at,
  heartbeatAt: row.heartbeat_at,
  cancellationRequestedAt: row.cancellation_requested_at,
  finishedAt: row.finished_at,
  error: row.error,
});

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: Database) {}
  create(source: Job["source"]): Job {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      this.db
        .query(
          "INSERT INTO jobs(id,type,source,status,created_at) VALUES(?,'sync_all',?,'pending',?)",
        )
        .run(id, source, now);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed"))
        throw Object.assign(new Error("Ya hay una sincronización activa."), {
          code: "SYNC_ALREADY_RUNNING",
        });
      throw error;
    }
    const created = this.findById(id);
    if (!created) throw new Error("No se pudo recuperar el job recién creado.");
    return created;
  }
  findById(id: string): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id=?").get(id);
    return row ? mapJob(row) : null;
  }
  findActive(): Job | null {
    const row = this.db
      .query(
        "SELECT * FROM jobs WHERE type='sync_all' AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1",
      )
      .get();
    return row ? mapJob(row) : null;
  }
  listRecent(limit = 20): Job[] {
    return (
      this.db
        .query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
        .all(limit) as any[]
    ).map(mapJob);
  }
  claim(id: string, workerId: string, workerPid: number): Job {
    const now = new Date().toISOString();
    const result = this.db
      .query(
        "UPDATE jobs SET status='running',worker_id=?,worker_pid=?,started_at=?,heartbeat_at=? WHERE id=? AND status='pending'",
      )
      .run(workerId, workerPid, now, now, id);
    if (!result.changes)
      throw Object.assign(new Error("El job no está pendiente."), {
        code: "JOB_NOT_PENDING",
      });
    const claimed = this.findById(id);
    if (!claimed) throw new Error("No se pudo recuperar el job reclamado.");
    return claimed;
  }
  heartbeat(id: string): void {
    this.db
      .query("UPDATE jobs SET heartbeat_at=? WHERE id=? AND status='running'")
      .run(new Date().toISOString(), id);
  }
  initializeItems(id: string, workIds: string[]): void {
    this.db.transaction(() => {
      this.db
        .query("UPDATE jobs SET total_items=? WHERE id=?")
        .run(workIds.length, id);
      for (const workId of workIds)
        this.db
          .query(
            "INSERT OR IGNORE INTO job_items(job_id,work_id,status) VALUES(?,?,'pending')",
          )
          .run(id, workId);
    })();
  }
  startItem(jobId: string, workId: string): void {
    this.db
      .query(
        "UPDATE job_items SET status='running',started_at=? WHERE job_id=? AND work_id=?",
      )
      .run(new Date().toISOString(), jobId, workId);
  }
  finishItem(
    jobId: string,
    workId: string,
    status: "unchanged" | "changed" | "failed",
    changes: string[] = [],
    error?: string,
  ): void {
    this.db.transaction(() => {
      this.db
        .query(
          "UPDATE job_items SET status=?,changes=?,error=?,finished_at=? WHERE job_id=? AND work_id=?",
        )
        .run(
          status,
          JSON.stringify(changes),
          error ?? null,
          new Date().toISOString(),
          jobId,
          workId,
        );
      this.db
        .query(`UPDATE jobs SET completed_items=completed_items+1,
        changed_items=changed_items+CASE WHEN ?='changed' THEN 1 ELSE 0 END,
        failed_items=failed_items+CASE WHEN ?='failed' THEN 1 ELSE 0 END,heartbeat_at=? WHERE id=?`)
        .run(status, status, new Date().toISOString(), jobId);
    })();
  }
  finish(id: string, status: JobStatus, error?: string): void {
    this.db
      .query(
        "UPDATE jobs SET status=?,error=?,finished_at=?,heartbeat_at=? WHERE id=?",
      )
      .run(
        status,
        error ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
        id,
      );
  }
  requestCancellation(id: string): void {
    this.db
      .query(
        "UPDATE jobs SET cancellation_requested_at=? WHERE id=? AND status IN ('pending','running')",
      )
      .run(new Date().toISOString(), id);
  }
  isCancellationRequested(id: string): boolean {
    return Boolean(
      (
        this.db
          .query("SELECT cancellation_requested_at FROM jobs WHERE id=?")
          .get(id) as any
      )?.cancellation_requested_at,
    );
  }
  interruptStale(staleBefore: string): number {
    return this.db
      .query(
        "UPDATE jobs SET status='interrupted',finished_at=?,error='Heartbeat caducado' WHERE status IN ('pending','running') AND COALESCE(heartbeat_at,created_at) < ?",
      )
      .run(new Date().toISOString(), staleBefore).changes;
  }
  listItems(id: string): JobItem[] {
    return (
      this.db
        .query(
          "SELECT * FROM job_items WHERE job_id=? ORDER BY started_at,work_id",
        )
        .all(id) as any[]
    ).map((row) => ({
      jobId: row.job_id,
      workId: row.work_id,
      status: row.status,
      changes: parseArray(row.changes),
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  }
}

export function createRepositories(db: Database) {
  return {
    works: new SqliteWorkRepository(db),
    jobs: new SqliteJobRepository(db),
  };
}
