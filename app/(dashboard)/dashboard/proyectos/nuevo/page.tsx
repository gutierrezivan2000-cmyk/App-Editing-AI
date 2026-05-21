"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { UploadZone } from "@/components/proyectos/UploadZone";
import { MultiUploadZone } from "@/components/proyectos/MultiUploadZone";
import { SubtitulosOverrideForm } from "@/components/proyectos/SubtitulosOverrideForm";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { ClipMultiSource, SubtitulosOverride } from "@/types";

type RenderMethod = "original" | "mirage" | "cortes" | "multiclip";

interface MethodOption {
  value: RenderMethod;
  label: string;
  tag: string;
  description: string;
}

const METHOD_OPTIONS: MethodOption[] = [
  {
    value: "multiclip",
    label: "Multi-clip con IA + guión opcional",
    tag: "Recomendado",
    description:
      "Subí varios clips (hasta 20). La IA transcribe, reordena y recorta según un guión opcional, y entrega un MP4 final unido + project files para Premiere/DaVinci/CapCut con todos los clips originales empaquetados.",
  },
  {
    value: "cortes",
    label: "Cortes con IA — pipeline completo",
    tag: "1 clip",
    description:
      "Whisper transcribe, Claude detecta silencios + errores + repeticiones + muletillas, ffmpeg corta y Remotion renderiza un MP4 final con subtítulos dinámicos. Incluye exports a Premiere, DaVinci y CapCut.",
  },
  {
    value: "original",
    label: "Original — Whisper + Remotion",
    tag: "1 clip",
    description:
      "Transcripción con Whisper, Claude decide énfasis y animación, Remotion renderiza subtítulos dinámicos sobre un MP4 final. Más simple.",
  },
  {
    value: "mirage",
    label: "Mirage — Captions.ai",
    tag: "Rápido · 9:16",
    description:
      "Subtítulos automáticos vía Captions.ai. Más rápido, sin Whisper ni Remotion. Requiere MIRAGE_API_KEY y MIRAGE_CAPTION_TEMPLATE_ID. Límite: 50 MB · 1 min · 9:16.",
  },
];

export default function NuevoProyectoPage() {
  const router = useRouter();
  const [footageUrl, setFootageUrl] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipMultiSource[]>([]);
  const [guion, setGuion] = useState<string>("");
  const [guionUploading, setGuionUploading] = useState(false);
  const [guionUploadError, setGuionUploadError] = useState<string | null>(null);
  const [subtitulosOverride, setSubtitulosOverride] = useState<
    SubtitulosOverride | undefined
  >(undefined);
  const [renderMethod, setRenderMethod] = useState<RenderMethod>("multiclip");
  const [renderSubtitulos, setRenderSubtitulos] = useState(false);
  const [incluirClipsEnZip, setIncluirClipsEnZip] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMulticlip = renderMethod === "multiclip";
  const canSubmit = isMulticlip ? clips.length > 0 : !!footageUrl;

  const handleGuionFile = async (file: File) => {
    setGuionUploadError(null);
    setGuionUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload-guion", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al parsear el archivo");
      setGuion(data.text as string);
    } catch (err) {
      setGuionUploadError(err instanceof Error ? err.message : "Error");
    } finally {
      setGuionUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (isMulticlip) {
      if (clips.length === 0) {
        setError("Subí al menos un clip.");
        return;
      }
    } else if (!footageUrl) {
      setError("Primero subí el video.");
      return;
    }
    setSubmitting(true);

    try {
      const form = new FormData(e.currentTarget);
      const body = {
        clienteId: form.get("clienteId") as string,
        nombre: form.get("nombre") as string,
        brief: form.get("brief") as string,
        footageUrl: isMulticlip ? clips[0].url : footageUrl,
        renderMethod,
        clickupTaskId: (form.get("clickupTaskId") as string) || undefined,
        clips: isMulticlip ? clips : undefined,
        guion: isMulticlip && guion.trim() ? guion.trim() : undefined,
        subtitulosOverride,
        renderSubtitulos: isMulticlip ? renderSubtitulos : undefined,
        incluirClipsEnZip: isMulticlip ? incluirClipsEnZip : undefined,
      };

      // Aborta si la red se queda esperando indefinidamente.
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      let res: Response;
      try {
        res = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error ?? `Error al encolar el proyecto (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      router.push(`/dashboard/proyectos/${json.projectId}`);
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      const msg = isAbort
        ? "La request se demoró más de 30s y fue abortada. Revisá la consola del navegador o el dev server."
        : err instanceof Error
          ? err.message
          : "Error desconocido";
      console.error("[encolar] error", err);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <Header
        title="Nuevo proyecto"
        description="Configurá el material, el modo de procesamiento y el brief. La IA hace el resto."
        actions={
          <Link
            href="/dashboard/proyectos"
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← Cancelar
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* ─── 1. Modo de procesamiento ─── */}
          <Section
            number={1}
            title="Modo de procesamiento"
            description="Elegí cómo la IA va a tratar el material. Multi-clip es lo más nuevo y flexible."
          >
            <div className="space-y-2.5">
              {METHOD_OPTIONS.map((opt) => (
                <MethodCard
                  key={opt.value}
                  option={opt}
                  selected={renderMethod === opt.value}
                  onSelect={() => setRenderMethod(opt.value)}
                />
              ))}
            </div>
          </Section>

          {/* ─── 2. Material ─── */}
          <Section
            number={2}
            title={isMulticlip ? "Clips de video" : "Footage de origen"}
            description={
              isMulticlip
                ? "Hasta 20 clips. Arrastrá para reordenar — la IA puede cambiar el orden si pasás un guión."
                : "Un solo video. MP4, MOV, hasta 500 MB."
            }
          >
            {isMulticlip ? (
              <MultiUploadZone value={clips} onChange={setClips} max={20} />
            ) : (
              <UploadZone onUploaded={setFootageUrl} />
            )}
          </Section>

          {/* ─── 3. Guión (solo multiclip) ─── */}
          {isMulticlip && (
            <Section
              number={3}
              title="Guión"
              optional
              description="Texto exacto que debe quedar en el video. La IA matchea cada línea con un tramo de tus clips. Si lo dejás vacío, la IA sigue el orden actual y solo limpia silencios/errores."
              action={
                <label className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline">
                  {guionUploading ? "Procesando…" : "Subir archivo (.txt/.docx/.pdf)"}
                  <input
                    type="file"
                    accept=".txt,.docx,.pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                    className="sr-only"
                    disabled={guionUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) handleGuionFile(f);
                    }}
                  />
                </label>
              }
            >
              {guionUploadError && (
                <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                  {guionUploadError}
                </div>
              )}
              <Textarea
                rows={8}
                placeholder={"Línea 1 del guión…\nLínea 2…\nLínea 3…"}
                value={guion}
                onChange={(e) => setGuion(e.target.value)}
                className="font-mono text-xs"
              />
            </Section>
          )}

          {/* ─── 4. Brief ─── */}
          <Section
            number={isMulticlip ? 4 : 3}
            title="Brief para Claude"
            description="Objetivo del video, tono, CTA, palabras clave a enfatizar. Cuanto más específico, mejor edita la IA."
          >
            <Textarea
              name="brief"
              rows={5}
              placeholder="Ej: Video para Reels de Instagram. Tono cercano y motivacional. CTA al final: 'agendá tu sesión gratis'. Enfatizar las palabras 'resultado', 'garantía', 'hoy'."
              required
            />
          </Section>

          {/* ─── 5. Subtítulos override (opcional) ─── */}
          <Section
            number={isMulticlip ? 5 : 4}
            title="Personalización de subtítulos"
            optional
            description="Por defecto se usan los del cliente. Si querés cambiar fuente, color o animación SOLO para este proyecto, activá esta sección."
          >
            <SubtitulosOverrideForm
              value={subtitulosOverride}
              onChange={setSubtitulosOverride}
            />
          </Section>

          {/* ─── 5.5. Quemado de subtítulos (solo multiclip) ─── */}
          {isMulticlip && (
            <Section
              number={6}
              title="Render MP4 con subtítulos quemados"
              optional
              description="Si lo dejás desactivado, el pipeline tarda 5-7 min y entrega los editables (CapCut/Premiere/DaVinci/SRT). Activalo solo si necesitás el MP4 listo para postear directo en redes — agrega 10-15 min al render."
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={renderSubtitulos}
                  onChange={(e) => setRenderSubtitulos(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Quemar subtítulos sobre el MP4 final
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Aplica fuente, color y animación de subtítulos del cliente
                    encima del video con Remotion. Útil para Reels/Shorts donde
                    el subtítulo es parte de la estética y no se edita después.
                  </p>
                </div>
              </label>
            </Section>
          )}

          {/* ─── 7. Embebido de clips en el ZIP CapCut (solo multiclip) ─── */}
          {isMulticlip && (
            <Section
              number={7}
              title="Empaquetar clips dentro del ZIP CapCut"
              optional
              description="Por defecto el ZIP queda en KB con solo el draft + un README listando las URLs públicas de los clips. Activá esto si querés un ZIP self-contained (puede pesar GB y agrega 10-15 min al pipeline por la descarga + empaquetado + upload)."
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={incluirClipsEnZip}
                  onChange={(e) => setIncluirClipsEnZip(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Incluir los clips originales dentro del ZIP
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Sin esto, el ZIP CapCut sólo trae el draft + meta + un
                    README con URLs — descargás los clips a mano (o con el
                    script incluido). Es mucho más rápido y suele ser lo
                    deseado en producción.
                  </p>
                </div>
              </label>
            </Section>
          )}

          {/* ─── 8. Datos del proyecto ─── */}
          <Section
            number={isMulticlip ? 8 : 5}
            title="Datos del proyecto"
            description="Identificación del proyecto y vínculo opcional con ClickUp."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nombre">Nombre del proyecto</Label>
                <Input
                  id="nombre"
                  name="nombre"
                  placeholder="Ep. 5 — Entrevista startup"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clienteId">ID del cliente</Label>
                <Input
                  id="clienteId"
                  name="clienteId"
                  placeholder="cliente-demo"
                  defaultValue="cliente-demo"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clickupTaskId">
                  Tarea ClickUp
                  <span className="ml-1 text-gray-400 font-normal">opcional</span>
                </Label>
                <Input
                  id="clickupTaskId"
                  name="clickupTaskId"
                  placeholder="abc123"
                />
              </div>
            </div>
          </Section>

          {/* ─── Submit ─── */}
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 border-t border-gray-200 bg-white/95 px-4 sm:px-6 lg:px-8 py-4 backdrop-blur">
            {error && (
              <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-gray-500">
                {canSubmit
                  ? isMulticlip
                    ? `${clips.length} clip${clips.length === 1 ? "" : "s"} listo${clips.length === 1 ? "" : "s"} para procesar`
                    : "Material listo para procesar"
                  : isMulticlip
                    ? "Subí al menos 1 clip para encolar"
                    : "Subí el video para encolar"}
              </p>
              <Button
                type="submit"
                loading={submitting}
                disabled={!canSubmit}
                size="md"
              >
                Encolar pipeline
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * Bloque de seccion numerada para el form. Mantiene jerarquia visual
 * consistente: numero circular grande, titulo, descripcion debajo, slot
 * opcional para action a la derecha (boton de upload archivo, etc).
 */
function Section({
  number,
  title,
  description,
  children,
  optional,
  action,
}: {
  number: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  optional?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-[auto_1fr]">
      <div className="hidden sm:block">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
          {number}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              {title}
              {optional && (
                <span className="text-xs font-normal text-gray-400">
                  opcional
                </span>
              )}
            </h2>
            {description && (
              <p className="mt-0.5 max-w-prose text-sm text-gray-500">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

/**
 * Card del selector de modo de pipeline. El estado seleccionado se
 * comunica con borde y background indigo + chequeo del radio. Mas
 * tactil que el approach anterior con styles inline.
 */
function MethodCard({
  option,
  selected,
  onSelect,
}: {
  option: MethodOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all",
        selected
          ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
      ].join(" ")}
    >
      <input
        type="radio"
        name="renderMethod"
        value={option.value}
        checked={selected}
        onChange={onSelect}
        className="mt-1 h-4 w-4 text-indigo-600"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={[
              "text-sm font-medium",
              selected ? "text-indigo-900" : "text-gray-900",
            ].join(" ")}
          >
            {option.label}
          </p>
          {option.tag && (
            <span
              className={[
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                selected
                  ? "bg-indigo-200 text-indigo-800"
                  : "bg-gray-100 text-gray-600",
              ].join(" ")}
            >
              {option.tag}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 leading-relaxed">
          {option.description}
        </p>
      </div>
    </label>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
