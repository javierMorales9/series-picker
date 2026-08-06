import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  advanceFn,
  discardFn,
  syncWorkFn,
  transitionFn,
  updateEntryDetailsFn,
  workDetailsFn,
} from "../server/functions.ts";

export const Route = createFileRoute("/works/$workId")({
  loader: ({ params }) => workDetailsFn({ data: { id: params.workId } }),
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

function WorkPage() {
  const aggregate = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  async function editDetails(entry: {
    id: string;
    locations: string[];
    platforms: string[];
    availability: "unknown" | "available" | "unavailable";
  }) {
    const locations = prompt(
      "Lugares separados por comas:",
      entry.locations.join(", "),
    );
    if (locations === null) return;
    const platforms = prompt(
      "Plataformas separadas por comas:",
      entry.platforms.join(", "),
    );
    if (platforms === null) return;
    const availability = prompt(
      "Disponibilidad: available, unavailable o unknown",
      entry.availability,
    );
    if (
      !availability ||
      !["available", "unavailable", "unknown"].includes(availability)
    )
      return;
    await action(() =>
      updateEntryDetailsFn({
        data: {
          entryId: entry.id,
          locations: locations
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          platforms: platforms
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          availability: availability as "unknown" | "available" | "unavailable",
        },
      }),
    );
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
          <h1>{aggregate.work.name}</h1>
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
            >
              Sincronizar
            </button>
            <button
              type="button"
              className="secondary"
              onClick={discard}
              disabled={busy}
            >
              Descartar
            </button>
            {aggregate.work.posterPath && (
              <a
                className="button secondary"
                href={`/api/poster?path=${encodeURIComponent(aggregate.work.posterPath)}&size=original&name=${encodeURIComponent(aggregate.work.name)}`}
              >
                Carátula original
              </a>
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
                <strong>{entry.name}</strong>
                <p>
                  {entry.releaseDate ?? "Sin fecha"} · {labels[entry.status]}
                </p>
                <p>
                  {entry.locations.join(", ") || "Lugar desconocido"}
                  {entry.platforms.length
                    ? ` · ${entry.platforms.join(", ")}`
                    : ""}{" "}
                  · {entry.availability}
                </p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => editDetails(entry)}
                  disabled={busy}
                >
                  Editar datos
                </button>
                {!["watched", "abandoned"].includes(entry.status) && (
                  <button
                    type="button"
                    onClick={() =>
                      action(() => advanceFn({ data: { entryId: entry.id } }))
                    }
                    disabled={busy}
                  >
                    Siguiente paso
                  </button>
                )}
                {entry.status === "watching" && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => abandon(entry.id)}
                    disabled={busy}
                  >
                    Abandonar
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
