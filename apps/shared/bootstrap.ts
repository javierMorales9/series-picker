import { SeriesApplication } from "@series-raqui/application";
import { loadConfig } from "@series-raqui/config";
import {
  createRepositories,
  migrate,
  openDatabase,
} from "@series-raqui/database";
import { TmdbClient } from "@series-raqui/tmdb";

export function bootstrap(options: { requireTmdb?: boolean } = {}) {
  const config = loadConfig(options);
  const db = openDatabase(config.databasePath);
  migrate(db);
  const repositories = createRepositories(db);
  const metadata = new TmdbClient(config.tmdbAccessToken);
  const app = new SeriesApplication({ ...repositories, metadata });
  return { config, db, metadata, app, ...repositories };
}
