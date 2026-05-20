"use client";

import { useState } from "react";
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
  { value: "pop-scale", label: "Pop-scale (rebote)" },
  { value: "slide-up", label: "Slide-up (subir)" },
  { value: "typewriter", label: "Typewriter (letra a letra)" },
  { value: "highlight", label: "Highlight (resaltado)" },
  { value: "karaoke", label: "Karaoke (línea completa)" },
];

const POSICIONES: { value: Posicion; label: string }[] = [
  { value: "bottom-center", label: "Abajo centro" },
  { value: "top-center", label: "Arriba centro" },
  { value: "center", label: "Centro" },
];

const DEFAULT_OVERRIDE = {
  fuente_principal: "Montserrat",
  fuente_enfasis: "Bebas Neue",
  tamano_base: 48,
  tamano_enfasis: 80,
  color_base: "#FFFFFF",
  color_enfasis: "#FF6B35",
  posicion: "bottom-center" as Posicion,
  animacion: "pop-scale" as Animacion,
  palabras_por_linea: 4,
  sombra: true,
};

interface Props {
  value: SubtitulosOverride | undefined;
  onChange: (v: SubtitulosOverride | undefined) => void;
}

export function SubtitulosOverrideForm({ value, onChange }: Props) {
  const enabled = value !== undefined;
  const [expanded, setExpanded] = useState(false);

  const current = value ?? DEFAULT_OVERRIDE;

  const update = (patch: SubtitulosOverride) => {
    onChange({ ...current, ...patch });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <p className="text-sm font-medium text-gray-900">
            Personalizar subtítulos para este proyecto
          </p>
          <p className="text-xs text-gray-500">
            Si no lo activas, se usan los del perfil del cliente.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              onChange({ ...DEFAULT_OVERRIDE });
              setExpanded(true);
            } else {
              onChange(undefined);
              setExpanded(false);
            }
          }}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600"
        />
      </label>

      {enabled && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-indigo-600 hover:text-indigo-700"
        >
          {expanded ? "Ocultar opciones" : "Mostrar opciones"}
        </button>
      )}

      {enabled && expanded && (
        <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-gray-200 p-4 bg-gray-50">
          <Field label="Color base">
            <input
              type="color"
              value={current.color_base ?? "#FFFFFF"}
              onChange={(e) => update({ color_base: e.target.value })}
              className="h-9 w-full rounded border border-gray-300"
            />
          </Field>
          <Field label="Color énfasis">
            <input
              type="color"
              value={current.color_enfasis ?? "#FF6B35"}
              onChange={(e) => update({ color_enfasis: e.target.value })}
              className="h-9 w-full rounded border border-gray-300"
            />
          </Field>

          <Field label="Tamaño base (px)">
            <input
              type="number"
              min={20}
              max={200}
              value={current.tamano_base ?? 48}
              onChange={(e) => update({ tamano_base: Number(e.target.value) })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            />
          </Field>
          <Field label="Tamaño énfasis (px)">
            <input
              type="number"
              min={20}
              max={300}
              value={current.tamano_enfasis ?? 80}
              onChange={(e) => update({ tamano_enfasis: Number(e.target.value) })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            />
          </Field>

          <Field label="Fuente principal">
            <select
              value={current.fuente_principal ?? "Montserrat"}
              onChange={(e) => update({ fuente_principal: e.target.value })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            >
              {FUENTES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fuente énfasis">
            <select
              value={current.fuente_enfasis ?? "Bebas Neue"}
              onChange={(e) => update({ fuente_enfasis: e.target.value })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            >
              {FUENTES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Animación">
            <select
              value={current.animacion ?? "pop-scale"}
              onChange={(e) => update({ animacion: e.target.value as Animacion })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            >
              {ANIMACIONES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Posición">
            <select
              value={current.posicion ?? "bottom-center"}
              onChange={(e) => update({ posicion: e.target.value as Posicion })}
              className="h-9 w-full rounded border border-gray-300 px-2"
            >
              {POSICIONES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Palabras por línea">
            <input
              type="number"
              min={1}
              max={10}
              value={current.palabras_por_linea ?? 4}
              onChange={(e) =>
                update({ palabras_por_linea: Number(e.target.value) })
              }
              className="h-9 w-full rounded border border-gray-300 px-2"
            />
          </Field>
          <Field label="Sombra">
            <label className="flex items-center gap-2 h-9">
              <input
                type="checkbox"
                checked={current.sombra ?? true}
                onChange={(e) => update({ sombra: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">Mostrar sombra</span>
            </label>
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
