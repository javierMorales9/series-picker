import type { Availability, WorkSummary } from "@series-raqui/application";
import type { OptionKind } from "@series-raqui/domain";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  type EntryDetails,
  EntryDetailsDialog,
} from "../components/EntryDetailsDialog.tsx";
import {
  activeJobFn,
  addWorkFn,
  advanceFn,
  dashboardFn,
  optionValuesFn,
  searchFn,
  setDefaultOptionFn,
  startSyncAllFn,
  updateEntryDetailsFn,
} from "../server/functions.ts";

interface Filters {
  lugar?: string;
  plataforma?: string;
  disponibilidad?: Availability;
}

const availabilityLabels: Record<Availability, string> = {
  unknown: "Desconocida",
  available: "Disponible",
  unavailable: "No disponible",
};

const advanceLabels: Record<string, string> = {
  unplanned: "Seleccionar",
  selected: "Marcar lista",
  ready: "Empezar",
  watching: "Terminar",
};

const busyTitle = "Espera a que termine la operación en curso.";

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Filters => {
    const disponibilidad = clean(search.disponibilidad);
    return {
      lugar: clean(search.lugar),
      plataforma: clean(search.plataforma),
      disponibilidad:
        disponibilidad && disponibilidad in availabilityLabels
          ? (disponibilidad as Availability)
          : undefined,
    };
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    Promise.all([
      dashboardFn({
        data: {
          location: deps.lugar,
          platform: deps.plataforma,
          availability: deps.disponibilidad,
        },
      }),
      activeJobFn(),
      optionValuesFn(),
    ]).then(([dashboard, job, options]) => ({ dashboard, job, options })),
  component: Home,
});

function Home() {
  const { dashboard, job: initialJob, options } = Route.useLoaderData();
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchFn>>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState(initialJob);
  const [editingId, setEditingId] = useState<string | null>(null);
  const filtering = Boolean(
    filters.lugar || filters.plataforma || filters.disponibilidad,
  );
  const editing = dashboard.all.find((work) => work.id === editingId);
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
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function advance(entryId: string) {
    await action(() => advanceFn({ data: { entryId } }));
  }
  async function saveDetails(entryId: string, details: EntryDetails) {
    setEditingId(null);
    await action(() => updateEntryDetailsFn({ data: { entryId, ...details } }));
  }
  async function setDefaultOption(kind: OptionKind, value: string | null) {
    await action(() => setDefaultOptionFn({ data: { kind, value } }));
  }
  async function syncAll() {
    setError(null);
    try {
      setJob(await startSyncAllFn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function setFilter(key: keyof Filters, value: string) {
    // resetScroll: false deja la página donde estaba al cambiar de filtro.
    navigate({
      search: { ...filters, [key]: value || undefined },
      resetScroll: false,
    });
  }
  const groups = [
    ["Viendo ahora", dashboard.watching],
    ["Próximas", dashboard.selected],
    ["Empezadas", dashboard.started],
    ...(filtering ? [] : ([["Por descubrir", dashboard.unplanned]] as const)),
  ] as const;
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Tu videoteca</p>
          <h1>¿Qué toca ver?</h1>
        </div>
        <button
          type="button"
          onClick={syncAll}
          disabled={Boolean(job)}
          title={job ? "Ya hay una sincronización en curso." : undefined}
        >
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
        <button
          type="button"
          onClick={search}
          disabled={busy || !query.trim()}
          title={
            busy
              ? "Espera a que termine la búsqueda en curso."
              : query.trim()
                ? undefined
                : "Escribe algo para buscar."
          }
        >
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
                  title={busy ? busyTitle : undefined}
                >
                  Añadir
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="filters">
        <select
          value={filters.lugar ?? ""}
          onChange={(e) => setFilter("lugar", e.target.value)}
          disabled={!options.locations.length}
          title={
            options.locations.length
              ? undefined
              : "Aún no hay lugares guardados."
          }
        >
          <option value="">Cualquier lugar</option>
          {options.locations.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value}
            </option>
          ))}
        </select>
        <select
          value={filters.plataforma ?? ""}
          onChange={(e) => setFilter("plataforma", e.target.value)}
          disabled={!options.platforms.length}
          title={
            options.platforms.length
              ? undefined
              : "Aún no hay plataformas guardadas."
          }
        >
          <option value="">Cualquier plataforma</option>
          {options.platforms.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value}
            </option>
          ))}
        </select>
        <select
          value={filters.disponibilidad ?? ""}
          onChange={(e) => setFilter("disponibilidad", e.target.value)}
        >
          <option value="">Cualquier disponibilidad</option>
          {Object.entries(availabilityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary"
          onClick={() => navigate({ search: {}, resetScroll: false })}
          disabled={!filtering}
          title={filtering ? undefined : "No hay filtros activos."}
        >
          Limpiar filtros
        </button>
      </section>
      {groups.map(([title, items]) => (
        <section key={title}>
          <div className="section-title">
            <h2>{title}</h2>
            <span>{items.length}</span>
          </div>
          {items.length ? (
            <div className="cards">
              {items.map((work) => (
                <WorkCard
                  key={work.id}
                  work={work}
                  busy={busy}
                  onAdvance={advance}
                  onEdit={setEditingId}
                />
              ))}
            </div>
          ) : (
            <p className="empty">Nada por aquí.</p>
          )}
        </section>
      ))}
      {!filtering && (
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
      )}
      {editing?.nextEntryId && (
        <EntryDetailsDialog
          key={editing.nextEntryId}
          entryName={`${editing.name} · ${editing.nextEntryName ?? ""}`}
          details={{
            locations: editing.nextEntryLocations,
            platforms: editing.nextEntryPlatforms,
            availability: editing.nextEntryAvailability ?? "unknown",
          }}
          options={options}
          busy={busy}
          onSave={(details) =>
            saveDetails(editing.nextEntryId as string, details)
          }
          onSetDefault={setDefaultOption}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function WorkCard({
  work,
  busy,
  onAdvance,
  onEdit,
}: {
  work: WorkSummary;
  busy: boolean;
  onAdvance: (entryId: string) => void;
  onEdit: (workId: string) => void;
}) {
  const advanceLabel = work.nextEntryStatus
    ? advanceLabels[work.nextEntryStatus]
    : undefined;
  return (
    <article className="card">
      <Link to="/works/$workId" params={{ workId: work.id }}>
        {work.posterPath ? (
          <img
            src={`https://image.tmdb.org/t/p/w500${work.posterPath}`}
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
      {work.nextEntryId && (
        <div className="card-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onEdit(work.id)}
            disabled={busy}
            title={
              busy ? busyTitle : `Editar datos de ${work.nextEntryName ?? ""}`
            }
          >
            Editar
          </button>
          {advanceLabel && (
            <button
              type="button"
              onClick={() => onAdvance(work.nextEntryId as string)}
              disabled={busy}
              title={
                busy
                  ? busyTitle
                  : `${advanceLabel}: ${work.nextEntryName ?? ""}`
              }
            >
              {advanceLabel}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
