import { resolve } from "node:path";
import type {
  Job,
  JobRepository,
  SeriesApplication,
} from "@series-raqui/application";
import { workspaceRoot } from "@series-raqui/config";

export const STALE_AFTER_MS = 120_000;

export class JobCoordinator {
  constructor(private readonly jobs: JobRepository) {}

  create(source: Job["source"]): Job {
    this.jobs.interruptStale(
      new Date(Date.now() - STALE_AFTER_MS).toISOString(),
    );
    return this.jobs.create(source);
  }

  launch(jobId: string): number {
    const root = workspaceRoot();
    const processHandle = Bun.spawn(
      [
        process.execPath,
        resolve(root, "apps/worker/src/sync-all.ts"),
        "--job-id",
        jobId,
      ],
      {
        cwd: root,
        env: { ...process.env },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    processHandle.unref();
    return processHandle.pid;
  }
}

export class SyncAllRunner {
  constructor(
    private readonly app: SeriesApplication,
    private readonly jobs: JobRepository,
  ) {}

  async run(jobId: string): Promise<Job> {
    const workerId = crypto.randomUUID();
    this.jobs.claim(jobId, workerId, process.pid);
    const works = this.app.listWorks();
    this.jobs.initializeItems(
      jobId,
      works.map((item) => item.work.id),
    );
    const heartbeat = setInterval(() => this.jobs.heartbeat(jobId), 15_000);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        if (this.jobs.isCancellationRequested(jobId)) return;
        const index = cursor++;
        const aggregate = works[index];
        if (!aggregate) return;
        this.jobs.startItem(jobId, aggregate.work.id);
        try {
          const result = await this.app.syncWork(aggregate.work.id);
          this.jobs.finishItem(
            jobId,
            aggregate.work.id,
            result.changes.length ? "changed" : "unchanged",
            result.changes,
          );
        } catch (error) {
          this.jobs.finishItem(
            jobId,
            aggregate.work.id,
            "failed",
            [],
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(3, Math.max(1, works.length)) }, worker),
      );
      const current = this.jobs.findById(jobId);
      if (!current) throw new Error("El job desapareció durante la ejecución.");
      if (this.jobs.isCancellationRequested(jobId))
        this.jobs.finish(jobId, "cancelled");
      else
        this.jobs.finish(
          jobId,
          current.failedItems ? "completed_with_errors" : "completed",
        );
    } catch (error) {
      this.jobs.finish(
        jobId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearInterval(heartbeat);
    }
    const completed = this.jobs.findById(jobId);
    if (!completed) throw new Error("El job desapareció tras la ejecución.");
    return completed;
  }
}
