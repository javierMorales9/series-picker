import { SyncAllRunner } from "@series-raqui/jobs";
import { bootstrap } from "../../shared/bootstrap.ts";

const index = process.argv.indexOf("--job-id");
const jobId = index >= 0 ? process.argv[index + 1] : undefined;
if (!jobId) {
  console.error("Falta --job-id.");
  process.exit(2);
}

const { app, jobs, db, config } = bootstrap();
try {
  if (!config.tmdbAccessToken) {
    jobs.finish(jobId, "failed", "Falta TMDB_ACCESS_TOKEN.");
    throw new Error("Falta TMDB_ACCESS_TOKEN.");
  }
  const result = await new SyncAllRunner(app, jobs).run(jobId);
  process.exitCode =
    result.status === "completed" || result.status === "completed_with_errors"
      ? 0
      : 1;
} finally {
  db.close();
}
