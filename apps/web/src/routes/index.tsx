import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  activeJobFn,
  addWorkFn,
  dashboardFn,
  searchFn,
  startSyncAllFn,
} from "../server/functions.ts";

export const Route = createFileRoute("/")({
  loader: () =>
    Promise.all([dashboardFn(), activeJobFn()]).then(([dashboard, job]) => ({
      dashboard,
      job,
    })),
  component: Home,
});

function Home() {
  const { dashboard, job: initialJob } = Route.useLoaderData();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchFn>>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState(initialJob);
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      const current = await activeJobFn();
      setJob(current);
      if (!current) {
        clearInterval(timer);
        router.invalidate();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [job, router]);
  async function search() {
    setBusy(true);
    setError(null);
    try {
      setResults(await searchFn({ data: { query } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function add(tmdbType: "tv" | "movie", tmdbId: number) {
    setBusy(true);
    try {
      const r = await addWorkFn({ data: { tmdbType, tmdbId } });
      await router.invalidate();
      setResults([]);
      setQuery("");
      location.href = `/works/${r.aggregate.work.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function syncAll() {
    setError(null);
    try {
      setJob(await startSyncAllFn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const groups = [
    ["Viendo ahora", dashboard.watching],
    ["Próximas", dashboard.selected],
    ["Empezadas", dashboard.started],
    ["Por descubrir", dashboard.unplanned],
  ] as const;
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Tu videoteca</p>
          <h1>¿Qué toca ver?</h1>
        </div>
        <button type="button" onClick={syncAll} disabled={Boolean(job)}>
          {job
            ? `Sincronizando ${job.completedItems}/${job.totalItems}`
            : "Actualizar biblioteca"}
        </button>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Buscar serie o película en TMDB…"
        />
        <button type="button" onClick={search} disabled={busy || !query.trim()}>
          Buscar
        </button>
      </section>
      {results.length > 0 && (
        <section className="search-results">
          {results.map((item) => (
            <article className="result" key={`${item.tmdbType}:${item.tmdbId}`}>
              {item.posterPath ? (
                <img
                  src={`https://image.tmdb.org/t/p/w185${item.posterPath}`}
                  alt=""
                />
              ) : (
                <div className="poster blank" />
              )}
              <div>
                <h3>{item.name}</h3>
                <p>
                  {item.tmdbType === "tv" ? "Serie" : "Película"}
                  {item.year ? ` · ${item.year}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => add(item.tmdbType, item.tmdbId)}
                  disabled={busy}
                >
                  Añadir
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {groups.map(([title, items]) => (
        <section key={title}>
          <div className="section-title">
            <h2>{title}</h2>
            <span>{items.length}</span>
          </div>
          {items.length ? (
            <div className="cards">
              {items.map((work) => (
                <Link
                  to="/works/$workId"
                  params={{ workId: work.id }}
                  className="card"
                  key={work.id}
                >
                  {work.posterPath ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w342${work.posterPath}`}
                      alt={`Carátula de ${work.name}`}
                    />
                  ) : (
                    <div className="poster blank" />
                  )}
                  <div>
                    <h3>{work.name}</h3>
                    <p>
                      {work.currentEntryName ??
                        `${work.watchedEntries}/${work.totalEntries} vistas`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">Nada por aquí.</p>
          )}
        </section>
      ))}
      <section>
        <div className="section-title">
          <h2>Toda la biblioteca</h2>
          <span>{dashboard.all.length}</span>
        </div>
        <div className="library-list">
          {dashboard.all.map((work) => (
            <Link
              to="/works/$workId"
              params={{ workId: work.id }}
              key={work.id}
            >
              <strong>{work.name}</strong>
              <span>
                {work.watchedEntries}/{work.totalEntries} · {work.status}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
