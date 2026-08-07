import type { OptionKind } from "@series-raqui/domain";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  type EntryDetails,
  EntryDetailsDialog,
} from "../components/EntryDetailsDialog.tsx";
import {
  advanceFn,
  discardFn,
  optionValuesFn,
  regressFn,
  rewatchWorkFn,
  setDefaultOptionFn,
  syncWorkFn,
  transitionFn,
  updateEntryDetailsFn,
  workDetailsFn,
} from "../server/functions.ts";

export const Route = createFileRoute("/works/$workId")({
  loader: ({ params }) =>
    Promise.all([
      workDetailsFn({ data: { id: params.workId } }),
      optionValuesFn(),
    ]).then(([aggregate, options]) => ({ aggregate, options })),
  component: WorkPage,
});

const labels: Record<string, string> = {
  unplanned: "No planificada",
  selected: "Seleccionada",
  ready: "Lista para ver",
  watching: "Viendo",
  watched: "Vista",
  abandoned: "Abandonada",
  completed: "Finalizada",
  started: "Empezada",
  discarded: "Descartada",
};

const advanceLabels: Record<string, string> = {
  unplanned: "Seleccionar",
  selected: "Marcar lista",
  ready: "Empezar",
  watching: "Terminar",
};

const availabilityLabels: Record<string, string> = {
  unknown: "Disponibilidad desconocida",
  available: "Disponible",
  unavailable: "No disponible",
};

const busyTitle = "Espera a que termine la operación en curso.";

const tmdbWorkUrl = (work: { tmdbType: "tv" | "movie"; tmdbId: number }) =>
  `https://www.themoviedb.org/${work.tmdbType}/${work.tmdbId}`;

const tmdbEntryUrl = (
  work: { tmdbType: "tv" | "movie"; tmdbId: number },
  entry: { type: "season" | "movie"; seasonNumber: number | null },
) => {
  if (entry.type === "season" && entry.seasonNumber !== null) {
    return `${tmdbWorkUrl(work)}/season/${entry.seasonNumber}`;
  }
  return tmdbWorkUrl(work);
};

function TmdbLink({ href }: { href: string }) {
  return (
    <a
      className="tmdb-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Ver en TMDB"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">Ver en TMDB</span>
    </a>
  );
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : null;
}

function WorkPage() {
  const { aggregate, options } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const canDiscard = ![
    "watching",
    "started",
    "completed",
    "abandoned",
  ].includes(aggregate.work.status);
  const discardTitle = busy
    ? busyTitle
    : canDiscard
      ? undefined
      : "No se puede descartar una Obra que ya has empezado a ver.";
  const editing = aggregate.entries.find((entry) => entry.id === editingId);
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
  async function abandon(entryId: string) {
    const reason = prompt("Motivo de abandono:");
    if (reason)
      await action(() =>
        transitionFn({ data: { entryId, target: "abandoned", reason } }),
      );
  }
  async function discard() {
    const reason = prompt("Motivo de descarte:");
    if (reason)
      await action(() =>
        discardFn({ data: { workId: aggregate.work.id, reason } }),
      );
  }
  async function saveDetails(entryId: string, details: EntryDetails) {
    setEditingId(null);
    await action(() => updateEntryDetailsFn({ data: { entryId, ...details } }));
  }
  async function setDefaultOption(kind: OptionKind, value: string | null) {
    await action(() => setDefaultOptionFn({ data: { kind, value } }));
  }
  return (
    <div className="page">
      <section className="work-head">
        {aggregate.work.posterPath && (
          <img
            src={`https://image.tmdb.org/t/p/w500${aggregate.work.posterPath}`}
            alt=""
          />
        )}
        <div>
          <p className="eyebrow">
            {aggregate.work.type === "series" ? "Serie" : "Película"}
          </p>
          <h1 className="titled">
            {aggregate.work.name}
            <TmdbLink href={tmdbWorkUrl(aggregate.work)} />
          </h1>
          <p className={`pill ${aggregate.work.status}`}>
            {labels[aggregate.work.status]}
          </p>
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                action(() =>
                  syncWorkFn({ data: { workId: aggregate.work.id } }),
                )
              }
              disabled={busy}
              title={busy ? busyTitle : undefined}
            >
              Sincronizar
            </button>
            <button
              type="button"
              className="secondary"
              onClick={discard}
              disabled={busy || !canDiscard}
              title={discardTitle}
            >
              Descartar
            </button>
            {aggregate.work.status === "completed" && (
              <button
                type="button"
                onClick={() =>
                  action(() =>
                    rewatchWorkFn({ data: { workId: aggregate.work.id } }),
                  )
                }
                disabled={busy}
                title={busy ? busyTitle : undefined}
              >
                Volver a ver
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
      <section>
        <div className="section-title">
          <h2>Entregas</h2>
          <span>
            {aggregate.entries.filter((e) => e.countsTowardsProgress).length}
          </span>
        </div>
        <div className="entries">
          {aggregate.entries.map((entry) => (
            <article className="entry" key={entry.id}>
              <div>
                <strong className="titled">
                  {entry.name}
                  <TmdbLink href={tmdbEntryUrl(aggregate.work, entry)} />
                </strong>
                <p>
                  {entry.releaseDate ?? "Sin fecha"} · {labels[entry.status]}
                </p>
                {entry.lastWatchedAt && (
                  <p>Vista por última vez: {formatDate(entry.lastWatchedAt)}</p>
                )}
                <p>
                  {entry.locations.join(", ") || "Lugar desconocido"}
                  {entry.platforms.length
                    ? ` · ${entry.platforms.join(", ")}`
                    : ""}{" "}
                  · {availabilityLabels[entry.availability]}
                </p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditingId(entry.id)}
                  disabled={busy}
                  title={busy ? busyTitle : undefined}
                >
                  Editar datos
                </button>
                {entry.status !== "unplanned" && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      action(() => regressFn({ data: { entryId: entry.id } }))
                    }
                    disabled={busy}
                    title={busy ? busyTitle : undefined}
                  >
                    Paso anterior
                  </button>
                )}
                {!["watched", "abandoned"].includes(entry.status) && (
                  <button
                    type="button"
                    onClick={() =>
                      action(() => advanceFn({ data: { entryId: entry.id } }))
                    }
                    disabled={busy}
                    title={busy ? busyTitle : undefined}
                  >
                    {advanceLabels[entry.status]}
                  </button>
                )}
                {entry.status === "watching" && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => abandon(entry.id)}
                    disabled={busy}
                    title={busy ? busyTitle : undefined}
                  >
                    Abandonar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      {editing && (
        <EntryDetailsDialog
          key={editing.id}
          entryName={editing.name}
          details={{
            locations: editing.locations,
            platforms: editing.platforms,
            availability: editing.availability,
          }}
          options={options}
          busy={busy}
          onSave={(details) => saveDetails(editing.id, details)}
          onSetDefault={setDefaultOption}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
