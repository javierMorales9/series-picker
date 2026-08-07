import type { OptionKind, OptionValue } from "@series-raqui/domain";
import { useEffect, useRef, useState } from "react";

const availabilityLabels: Record<string, string> = {
  unknown: "Desconocida",
  available: "Disponible",
  unavailable: "No disponible",
};

type Availability = "unknown" | "available" | "unavailable";

export interface EntryDetails {
  locations: string[];
  platforms: string[];
  availability: Availability;
}

function TagSelect({
  label,
  known,
  selected,
  onChange,
  onSetDefault,
  busy,
}: {
  label: string;
  known: OptionValue[];
  selected: string[];
  onChange: (values: string[]) => void;
  onSetDefault: (value: string | null) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const available = known.filter((option) => !selected.includes(option.value));
  const currentDefault = known.find((option) => option.isDefault)?.value ?? "";

  function add(value: string) {
    const clean = value.trim();
    if (!clean || selected.includes(clean)) return;
    onChange([...selected, clean]);
    setDraft("");
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips">
        {selected.length ? (
          selected.map((value) => (
            <span className="chip" key={value}>
              {value}
              <button
                type="button"
                className="chip-remove"
                aria-label={`Quitar ${value}`}
                onClick={() => onChange(selected.filter((v) => v !== value))}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="empty">Sin seleccionar</span>
        )}
      </div>
      <div className="field-row">
        <select
          value=""
          onChange={(event) => add(event.target.value)}
          disabled={!available.length}
          title={
            available.length
              ? undefined
              : "No quedan opciones guardadas por añadir."
          }
        >
          <option value="">Añadir de la lista…</option>
          {available.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value}
              {option.isDefault ? " (por defecto)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <input
          value={draft}
          placeholder="Nueva opción…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          title={draft.trim() ? undefined : "Escribe un valor para añadirlo."}
        >
          Añadir
        </button>
      </div>
      <div className="field-row">
        <select
          value={currentDefault}
          onChange={(event) => onSetDefault(event.target.value || null)}
          disabled={busy || !known.length}
          title={
            busy
              ? "Espera a que termine la operación en curso."
              : known.length
                ? undefined
                : "Aún no hay opciones guardadas."
          }
        >
          <option value="">Sin opción por defecto</option>
          {known.map((option) => (
            <option key={option.value} value={option.value}>
              Por defecto: {option.value}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function EntryDetailsDialog({
  entryName,
  details,
  options,
  busy,
  onSave,
  onSetDefault,
  onClose,
}: {
  entryName: string;
  details: EntryDetails;
  options: { locations: OptionValue[]; platforms: OptionValue[] };
  busy: boolean;
  onSave: (details: EntryDetails) => void;
  onSetDefault: (kind: OptionKind, value: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(details);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="details-dialog" onClose={onClose}>
      <h3>{entryName}</h3>
      <TagSelect
        label="Lugares"
        known={options.locations}
        selected={draft.locations}
        onChange={(locations) => setDraft({ ...draft, locations })}
        onSetDefault={(value) => onSetDefault("location", value)}
        busy={busy}
      />
      <TagSelect
        label="Plataformas"
        known={options.platforms}
        selected={draft.platforms}
        onChange={(platforms) => setDraft({ ...draft, platforms })}
        onSetDefault={(value) => onSetDefault("platform", value)}
        busy={busy}
      />
      <div className="field">
        <span className="field-label">Disponibilidad</span>
        <select
          value={draft.availability}
          onChange={(event) =>
            setDraft({
              ...draft,
              availability: event.target.value as Availability,
            })
          }
        >
          {Object.entries(availabilityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={busy}
          title={
            busy ? "Espera a que termine la operación en curso." : undefined
          }
        >
          Guardar
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => ref.current?.close()}
        >
          Cancelar
        </button>
      </div>
    </dialog>
  );
}
