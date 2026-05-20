"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

interface CorteStatus {
  id: string;
  nombre: string;
  status: "pending" | "processing" | "completed" | "error";
  xmlUrl?: string;
  edlUrl?: string;
  capcutUrl?: string;
  footageUrl?: string;
  localFilename?: string;
  errorMessage?: string;
  silenciosCount: number;
  segmentsCount: number;
  duracionSeg: number;
}

const STEPS = [
  "Descarga de footage",
  "Extracción de metadata",
  "Detección de silencios",
  "Generación de XML / EDL / CapCut",
  "Finalizado",
];

export default function CorteDetailPage() {
  const params = useParams<{ id: string }>();
  const [corte, setCorte] = useState<CorteStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchStatus = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/cortar/${params.id}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "No se pudo cargar el corte");
        }
        const data = (await res.json()) as CorteStatus;
        if (cancelled) return;
        setCorte(data);
        // Polling adaptativo: 1.5s en processing, 3s en pending, 0 cuando termina.
        if (data.status === "processing") {
          timeoutId = setTimeout(fetchStatus, 1500);
        } else if (data.status === "pending") {
          timeoutId = setTimeout(fetchStatus, 3000);
        }
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Error");
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [params.id]);

  if (loadError) {
    return (
      <div className="flex flex-col">
        <Header title="Corte" />
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        </div>
      </div>
    );
  }

  if (!corte) {
    return (
      <div className="flex flex-col">
        <Header title="Corte" description="Cargando…" />
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
    );
  }

  const completed = corte.status === "completed";
  const errored = corte.status === "error";
  const processing = corte.status === "processing";
  // Indice del paso ACTUAL: aproximamos por status. Si esta processing,
  // mostramos el penultimo paso. Si esta completed, todos done.
  const stepIndex = completed
    ? STEPS.length
    : processing
      ? Math.max(0, STEPS.length - 2)
      : 0;

  return (
    <div className="flex flex-col">
      <Header
        title={corte.nombre}
        description={describeStatus(corte.status)}
        actions={
          <Link
            href="/dashboard/cortar"
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← Todos los cortes
          </Link>
        }
      />

      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">
              Estado del pipeline
            </h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="space-y-1.5">
              {STEPS.map((step, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex && processing;
                const failed = i === stepIndex && errored;
                return (
                  <li
                    key={step}
                    className={[
                      "flex items-center gap-3 text-sm rounded-md px-2 py-1.5 transition-colors",
                      active && "bg-blue-50",
                      failed && "bg-red-50",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span
                      className={[
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                        done
                          ? "bg-emerald-100 text-emerald-700"
                          : active
                            ? "bg-blue-600 text-white"
                            : failed
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-400",
                      ].join(" ")}
                    >
                      {done ? (
                        <CheckIcon className="h-3.5 w-3.5" />
                      ) : active ? (
                        <SpinnerIcon className="h-3 w-3 animate-spin" />
                      ) : failed ? (
                        <CrossIcon className="h-3 w-3" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={
                        done
                          ? "text-gray-700"
                          : active
                            ? "font-medium text-blue-700"
                            : failed
                              ? "font-medium text-red-700"
                              : "text-gray-400"
                      }
                    >
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>

            {errored && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                <strong>Error:</strong> {corte.errorMessage ?? "Error desconocido"}
              </div>
            )}
          </CardContent>
        </Card>

        {completed && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Duración total" value={`${corte.duracionSeg.toFixed(1)} s`} />
              <Stat label="Silencios" value={corte.silenciosCount} />
              <Stat label="Segmentos" value={corte.segmentsCount} />
            </div>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900">
                  Descargas
                </h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {corte.footageUrl && (
                    <DownloadButton
                      href={`/api/cortar/${corte.id}/download?type=footage`}
                      variant="secondary"
                    >
                      Vídeo original
                    </DownloadButton>
                  )}
                  {corte.xmlUrl && (
                    <DownloadButton
                      href={`/api/cortar/${corte.id}/download?type=xml`}
                    >
                      XML — Premiere Pro
                    </DownloadButton>
                  )}
                  {corte.edlUrl && (
                    <DownloadButton
                      href={`/api/cortar/${corte.id}/download?type=edl`}
                      variant="secondary"
                    >
                      EDL — DaVinci Resolve
                    </DownloadButton>
                  )}
                  {corte.capcutUrl && (
                    <DownloadButton
                      href={`/api/cortar/${corte.id}/download?type=capcut`}
                      variant="secondary"
                    >
                      Proyecto CapCut
                    </DownloadButton>
                  )}
                </div>

                <Instructions localFilename={corte.localFilename} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {value}
      </p>
    </div>
  );
}

function DownloadButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <a href={href} className="flex-1 sm:min-w-[180px] sm:flex-none">
      <Button
        variant={variant}
        className={`w-full justify-start sm:w-auto`}
      >
        <DownloadIcon className="h-4 w-4" />
        {children}
      </Button>
    </a>
  );
}

function Instructions({ localFilename }: { localFilename?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Cómo usar los archivos
      </p>
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold text-gray-900">Premiere Pro</dt>
          <dd>
            Descargá el vídeo original y el XML en la misma carpeta. En Premiere{" "}
            <em>File → Import</em> y seleccioná el XML. Si pide relink, apuntá al
            vídeo descargado
            {localFilename ? (
              <>
                {" "}
                (<code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] border border-gray-200">
                  {localFilename}
                </code>
                )
              </>
            ) : null}
            .
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-900">DaVinci Resolve</dt>
          <dd>
            <em>File → Import Timeline → Import EDL</em>, seleccioná el EDL y
            re-enlazá el media al footage original.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-900">CapCut Desktop</dt>
          <dd>
            Descomprimí el ZIP en{" "}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] border border-gray-200">
              %USERPROFILE%\Documents\CapCut\User Data\Projects\com.lveditor.draft\
            </code>
            . Reabrí CapCut y el proyecto aparece en drafts.
          </dd>
        </div>
      </dl>
    </div>
  );
}

function describeStatus(s: CorteStatus["status"]): string {
  switch (s) {
    case "pending":
      return "En cola, esperando worker…";
    case "processing":
      return "Procesando — esto suele tardar 30-60 segundos";
    case "completed":
      return "Listo. Descargá los archivos abajo.";
    case "error":
      return "Falló durante el procesamiento.";
  }
}

// ─── Iconos ──────────────────────────────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 3a1 1 0 011 1v8.586l3.293-3.293a1 1 0 011.414 1.414l-5 5a1 1 0 01-1.414 0l-5-5a1 1 0 011.414-1.414L9 12.586V4a1 1 0 011-1z" />
      <path d="M3 16a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
    </svg>
  );
}
