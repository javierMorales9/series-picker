import { unlinkSync } from "node:fs";
import { loadConfig } from "@series-raqui/config";
import { migrate, migrations, openDatabase } from "@series-raqui/database";

const command = process.argv[2] ?? "status";
const config = loadConfig();
if (command === "reset") {
  if (process.env.NODE_ENV === "production")
    throw new Error("db:reset no está permitido en producción.");
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${config.databasePath}${suffix}`);
    } catch {}
  }
}
const db = openDatabase(config.databasePath);
try {
  const applied = migrate(db);
  const rows = db
    .query(
      "SELECT version,name,applied_at FROM schema_migrations ORDER BY version",
    )
    .all();
  if (command === "migrate" || command === "reset")
    console.log(
      applied.length
        ? `Migraciones aplicadas: ${applied.join(", ")}`
        : "Base de datos al día.",
    );
  else console.table(rows);
  if (rows.length !== migrations.length) process.exitCode = 1;
} finally {
  db.close();
}
