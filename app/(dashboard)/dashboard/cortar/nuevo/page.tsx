"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { UploadZone } from "@/components/proyectos/UploadZone";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

export default function NuevoCortePage() {
  const router = useRouter();
  const [footageUrl, setFootageUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!footageUrl) {
      setError("Primero subí el video.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/cortar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.get("nombre") as string,
          footageUrl,
          umbralDb: Number(form.get("umbralDb") ?? -30),
          duracionMinima: Number(form.get("duracionMinima") ?? 0.5),
          margenSeg: Number(form.get("margenSeg") ?? 0.05),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? "Error al encolar");
      }

      const { corteId } = await res.json();
      router.push(`/dashboard/cortar/${corteId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <Header
        title="Nuevo corte"
        description="Cortes mecánicos por detección de silencio. Sin IA, sin transcripción — el más rápido."
        actions={
          <Link
            href="/dashboard/cortar"
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← Cancelar
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <Section
            number={1}
            title="Footage"
            description="MP4, MOV, hasta 500 MB."
          >
            <UploadZone onUploaded={setFootageUrl} />
          </Section>

          <Section
            number={2}
            title="Parámetros de detección"
            description="Defaults razonables para entrevistas y reels. Ajustá si el video tiene música de fondo o si querés cortes más agresivos."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ParamField
                id="umbralDb"
                label="Umbral (dB)"
                defaultValue={-30}
                step="1"
                hint="Más bajo = más sensible. Típico: −30 a −45"
              />
              <ParamField
                id="duracionMinima"
                label="Duración mínima (s)"
                defaultValue={0.5}
                step="0.1"
                hint="Silencios más cortos se ignoran"
              />
              <ParamField
                id="margenSeg"
                label="Margen (s)"
                defaultValue={0.05}
                step="0.01"
                hint="Padding antes/después del corte"
              />
            </div>
          </Section>

          <Section
            number={3}
            title="Nombre"
            description="Para identificarlo en el listado."
          >
            <Input
              id="nombre"
              name="nombre"
              placeholder="Reel 5 — entrevista"
              required
            />
          </Section>

          <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 border-t border-gray-200 bg-white/95 px-4 sm:px-6 lg:px-8 py-4 backdrop-blur">
            {error && (
              <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-gray-500">
                {footageUrl
                  ? "Material listo, podés encolar"
                  : "Subí un video para continuar"}
              </p>
              <Button type="submit" loading={submitting} disabled={!footageUrl}>
                Encolar corte
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Section({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-[auto_1fr]">
      <div className="hidden sm:block">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
          {number}
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description && (
            <p className="mt-0.5 max-w-prose text-sm text-gray-500">
              {description}
            </p>
          )}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

function ParamField({
  id,
  label,
  defaultValue,
  step,
  hint,
}: {
  id: string;
  label: string;
  defaultValue: number;
  step: string;
  hint: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        step={step}
        defaultValue={defaultValue}
      />
      <p className="text-[11px] text-gray-400">{hint}</p>
    </div>
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
