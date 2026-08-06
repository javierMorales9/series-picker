import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  activeJobFn,
  cancelJobFn,
  recentJobsFn,
  startSyncAllFn,
} from "../server/functions.ts";

export const Route = createFileRoute("/jobs")({
  loader: () =>
    Promise.all([activeJobFn(), recentJobsFn()]).then(([active, recent]) => ({
      active,
      recent,
    })),
  component: Jobs,
});
function Jobs() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const [active, setActive] = useState(initial.active);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const current = await activeJobFn();
      setActive(current);
      if (!current) {
        clearInterval(timer);
        router.invalidate();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  async function start() {
    try {
      setActive(await startSyncAllFn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function cancel() {
    if (active) await cancelJobFn({ data: { id: active.id } });
  }
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Operaciones</p>
          <h1>Sincronización</h1>
        </div>
        <button type="button" onClick={start} disabled={Boolean(active)}>
          Actualizar todo
        </button>
      </section>
      {error && <p className="error">{error}</p>}
      {active && (
        <section className="job-active">
          <h2>En curso</h2>
          <p>
            {active.completedItems} de {active.totalItems} ·{" "}
            {active.failedItems} errores
          </p>
          <progress
            value={active.completedItems}
            max={Math.max(1, active.totalItems)}
          />
          <button type="button" className="danger" onClick={cancel}>
            Cancelar
          </button>
        </section>
      )}
      <section>
        <h2>Historial</h2>
        <div className="entries">
          {initial.recent.map((job) => (
            <article className="entry" key={job.id}>
              <div>
                <strong>{job.status}</strong>
                <p>
                  {new Date(job.createdAt).toLocaleString("es-ES")} ·{" "}
                  {job.completedItems}/{job.totalItems}
                </p>
              </div>
              <code>{job.source}</code>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
