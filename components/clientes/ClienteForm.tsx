"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { ClienteProfile } from "@/types";

interface ClienteFormProps {
  initial?: Partial<ClienteProfile>;
  onSave: (profile: ClienteProfile) => Promise<void>;
}

const REDES_OPTIONS: ClienteProfile["redes"][number][] = [
  "instagram_reels",
  "tiktok",
  "youtube_shorts",
  "instagram_stories",
];

const ANIMATION_OPTIONS: ClienteProfile["subtitulos"]["animacion"][] = [
  "pop-scale",
  "slide-up",
  "typewriter",
  "highlight",
  "karaoke",
];

export const ClienteForm = ({ initial, onSave }: ClienteFormProps) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ClienteProfile>({
    id: initial?.id ?? "",
    nombre: initial?.nombre ?? "",
    redes: initial?.redes ?? ["instagram_reels"],
    subtitulos: {
      fuente_principal: initial?.subtitulos?.fuente_principal ?? "Montserrat",
      fuente_enfasis: initial?.subtitulos?.fuente_enfasis ?? "Bebas Neue",
      tamano_base: initial?.subtitulos?.tamano_base ?? 48,
      tamano_enfasis: initial?.subtitulos?.tamano_enfasis ?? 80,
      color_base: initial?.subtitulos?.color_base ?? "#FFFFFF",
      color_enfasis: initial?.subtitulos?.color_enfasis ?? "#FF6B35",
      posicion: initial?.subtitulos?.posicion ?? "bottom-center",
      animacion: initial?.subtitulos?.animacion ?? "pop-scale",
      palabras_por_linea: initial?.subtitulos?.palabras_por_linea ?? 4,
      sombra: initial?.subtitulos?.sombra ?? true,
    },
    silencio: {
      umbral_db: initial?.silencio?.umbral_db ?? -35,
      duracion_minima_seg: initial?.silencio?.duracion_minima_seg ?? 0.4,
      margen_seg: initial?.silencio?.margen_seg ?? 0.15,
    },
    exportacion: {
      formatos: initial?.exportacion?.formatos ?? ["9:16"],
      fps: initial?.exportacion?.fps ?? 30,
      bitrate: initial?.exportacion?.bitrate ?? "8M",
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="id">ID</Label>
          <Input
            id="id"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            placeholder="cliente-demo"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            placeholder="Mi Cliente"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Redes sociales</Label>
        <div className="flex flex-wrap gap-3">
          {REDES_OPTIONS.map((red) => (
            <label key={red} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.redes.includes(red)}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    redes: e.target.checked
                      ? ([...f.redes, red] as ClienteProfile["redes"])
                      : (f.redes.filter((r) => r !== red) as ClienteProfile["redes"]),
                  }));
                }}
              />
              {red}
            </label>
          ))}
        </div>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Subtítulos</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fuente_principal">Fuente principal</Label>
            <Input
              id="fuente_principal"
              value={form.subtitulos.fuente_principal}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: { ...f.subtitulos, fuente_principal: e.target.value },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fuente_enfasis">Fuente énfasis</Label>
            <Input
              id="fuente_enfasis"
              value={form.subtitulos.fuente_enfasis}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: { ...f.subtitulos, fuente_enfasis: e.target.value },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="color_base">Color base</Label>
            <Input
              id="color_base"
              type="color"
              value={form.subtitulos.color_base}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: { ...f.subtitulos, color_base: e.target.value },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="color_enfasis">Color énfasis</Label>
            <Input
              id="color_enfasis"
              type="color"
              value={form.subtitulos.color_enfasis}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: { ...f.subtitulos, color_enfasis: e.target.value },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="animacion">Animación</Label>
            <select
              id="animacion"
              value={form.subtitulos.animacion}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: {
                    ...f.subtitulos,
                    animacion: e.target.value as ClienteProfile["subtitulos"]["animacion"],
                  },
                }))
              }
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {ANIMATION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="palabras_por_linea">Palabras por línea</Label>
            <Input
              id="palabras_por_linea"
              type="number"
              min={1}
              max={10}
              value={form.subtitulos.palabras_por_linea}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  subtitulos: {
                    ...f.subtitulos,
                    palabras_por_linea: Number(e.target.value),
                  },
                }))
              }
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.subtitulos.sombra}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                subtitulos: { ...f.subtitulos, sombra: e.target.checked },
              }))
            }
          />
          Activar sombra de texto
        </label>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">Silencio</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="umbral_db">Umbral (dB)</Label>
            <Input
              id="umbral_db"
              type="number"
              value={form.silencio.umbral_db}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  silencio: { ...f.silencio, umbral_db: Number(e.target.value) },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="duracion_minima">Duración mínima (seg)</Label>
            <Input
              id="duracion_minima"
              type="number"
              step="0.1"
              value={form.silencio.duracion_minima_seg}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  silencio: {
                    ...f.silencio,
                    duracion_minima_seg: Number(e.target.value),
                  },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="margen">Margen (seg)</Label>
            <Input
              id="margen"
              type="number"
              step="0.01"
              value={form.silencio.margen_seg}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  silencio: { ...f.silencio, margen_seg: Number(e.target.value) },
                }))
              }
            />
          </div>
        </div>
      </fieldset>

      <Button type="submit" loading={saving}>
        Guardar cliente
      </Button>
    </form>
  );
};
