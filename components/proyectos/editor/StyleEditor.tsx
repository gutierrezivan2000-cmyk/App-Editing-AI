"use client";

import { useMemo } from "react";
import type { ClienteProfile, SubtitulosOverride } from "@/types";

type Animacion = ClienteProfile["subtitulos"]["animacion"];
type Posicion = ClienteProfile["subtitulos"]["posicion"];

const FUENTES = [
  "Montserrat",
  "Bebas Neue",
  "Inter",
  "Poppins",
  "Oswald",
  "Roboto",
  "Anton",
  "Archivo Black",
];

const ANIMACIONES: { value: Animacion; label: string }[] = [
  { value: "pop-scale", label: "Pop-scale" },
  { value: "slide-up", label: "Slide-up" },
  { value: "typewriter", label: "Typewriter" },
  { value: "highlight", label: "Highlight" },
  { value: "karaoke", label: "Karaoke" },
];

const POSICIONES: { value: Posicion; label: string }[] = [
  { value: "bottom-center", label: "Abajo" },
  { value: "center", label: "Centro" },
  { value: "top-center", label: "Arriba" },
];

interface StyleEditorProps {
  /** Override actual del proyecto (null = usar 100% el del cliente). */
  value: SubtitulosOverride | null;
  /** Setter — null = reset (el preview vuelve a usar el del cliente). */
  onChange: (next: SubtitulosOverride | null) => void;
  /** Config base del cliente — sirve para mostrar los defaults. */
  cliente: ClienteProfile;
}

/**
 * Editor de estilo de subtitulos dentro del editor visual.
 *
 * A diferencia del SubtitulosOverrideForm del flujo de creacion, este NO
 * tiene checkbox enable/disable — en el editor el override esta siempre
 * activo (o explicitamente null si el usuario tocara "Reset"). Esto se
 * mergea sobre `cliente.subtitulos` en el preview y en regenerate-editables.
 *
 * Cada cambio se propaga al EditorState (snapshot historiable), asi que el
 * undo/redo cubre tambien las decisiones de estilo.
 */
export function StyleEditor({ value, onChange, cliente }: StyleEditorProps) {
  // Lo que se muestra en cada input — si no hay override, mostramos el del
  // cliente. Cuando el usuario cambia algo, materializamos el override entero
  // (no solo el campo cambiado) para que el merge sea predecible.
  const efectivo = useMemo(
    () => ({ ...cliente.subtitulos, ...(value ?? {}) }),
    [cliente.subtitulos, value],
  );

  const isOverridden = value !== null;

  const update = (patch: SubtitulosOverride) => {
    onChange({ ...efectivo, ...patch });
  };

  return (
    <div className="space-y-5 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/30">
          <BrushIcon className="h-4 w-4 text-indigo-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">
              Estilo de subtítulos
            </h3>
            {isOverridden ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                personalizado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                heredado
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {isOverridden
              ? "Estos valores reemplazan los del cliente solo en este proyecto."
              : `Tomando los valores del cliente “${cliente.nombre}”. Edita cualquier campo para personalizarlos.`}
          </p>
          {isOverridden && (
            <button
              onClick={() => onChange(null)}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400 transition-colors hover:text-indigo-300"
              title="Volver al estilo del cliente"
            >
              <ResetIcon className="h-2.5 w-2.5" />
              Volver al del cliente
            </button>
          )}
        </div>
      </div>

      {/* Colores */}
      <Section title="Colores">
        <div className="grid grid-cols-2 gap-3">
          <ColorField
            label="Base"
            value={efectivo.color_base}
            onChange={(c) => update({ color_base: c })}
          />
          <ColorField
            label="Énfasis"
            value={efectivo.color_enfasis}
            onChange={(c) => update({ color_enfasis: c })}
          />
        </div>
      </Section>

      {/* Tamaños */}
      <Section title="Tamaños">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Base"
            value={efectivo.tamano_base}
            min={20}
            max={200}
            suffix="px"
            onChange={(v) => update({ tamano_base: v })}
          />
          <NumberField
            label="Énfasis"
            value={efectivo.tamano_enfasis}
            min={20}
            max={300}
            suffix="px"
            onChange={(v) => update({ tamano_enfasis: v })}
          />
        </div>
      </Section>

      {/* Fuentes */}
      <Section title="Fuentes">
        <div className="grid grid-cols-1 gap-3">
          <SelectField
            label="Principal"
            value={efectivo.fuente_principal}
            onChange={(v) => update({ fuente_principal: v })}
            options={FUENTES.map((f) => ({ value: f, label: f }))}
          />
          <SelectField
            label="Énfasis"
            value={efectivo.fuente_enfasis}
            onChange={(v) => update({ fuente_enfasis: v })}
            options={FUENTES.map((f) => ({ value: f, label: f }))}
          />
        </div>
      </Section>

      {/* Animación + Posición */}
      <Section title="Animación y posición">
        <div className="grid grid-cols-1 gap-3">
          <SelectField
            label="Animación"
            value={efectivo.animacion}
            onChange={(v) => update({ animacion: v as Animacion })}
            options={ANIMACIONES.map((a) => ({ value: a.value, label: a.label }))}
          />
          <SelectField
            label="Posición"
            value={efectivo.posicion}
            onChange={(v) => update({ posicion: v as Posicion })}
            options={POSICIONES.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
      </Section>

      {/* Layout fino */}
      <Section title="Layout">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Palabras / línea"
            value={efectivo.palabras_por_linea}
            min={1}
            max={10}
            onChange={(v) => update({ palabras_por_linea: v })}
          />
          <ToggleField
            label="Sombra"
            checked={efectivo.sombra}
            onChange={(v) => update({ sombra: v })}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 transition-colors focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-zinc-700 bg-transparent"
          aria-label={`Color ${label}`}
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            const next = e.target.value.trim();
            if (/^#[0-9A-Fa-f]{0,6}$/.test(next)) onChange(next);
          }}
          className="flex-1 bg-transparent font-mono text-xs uppercase tabular-nums text-zinc-200 outline-none"
          spellCheck={false}
        />
      </div>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 transition-colors focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) {
              const clamped =
                min !== undefined && n < min
                  ? min
                  : max !== undefined && n > max
                    ? max
                    : n;
              onChange(clamped);
            }
          }}
          className="w-full bg-transparent font-mono text-sm tabular-nums text-zinc-100 outline-none"
        />
        {suffix && (
          <span className="font-mono text-[10px] text-zinc-500">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 transition-colors focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-zinc-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={[
          "flex h-8 items-center justify-between rounded-md border px-2.5 text-xs font-medium transition-colors",
          checked
            ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-200"
            : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
        ].join(" ")}
        aria-pressed={checked}
      >
        <span>{checked ? "Activada" : "Desactivada"}</span>
        <span
          className={[
            "h-4 w-7 rounded-full p-0.5 transition-colors",
            checked ? "bg-indigo-500" : "bg-zinc-800",
          ].join(" ")}
        >
          <span
            className={[
              "block h-3 w-3 rounded-full bg-white transition-transform",
              checked ? "translate-x-3" : "translate-x-0",
            ].join(" ")}
          />
        </span>
      </button>
    </label>
  );
}

function BrushIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
  );
}

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
