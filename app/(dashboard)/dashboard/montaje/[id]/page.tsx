"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface MontajeStatus {
  id: string;
  nombre: string;
  footageUrl?: string;
  videoFinalUrl?: string;
  status: "pending" | "processing" | "completed" | "error";
  step?: string;
  errorMessage?: string;
  silenciosCount: number;
  segmentsCount: number;
  duracionOriginalSeg: number;
  duracionFinalSeg: number;
}

const STEP_LABELS: Record<string, string> = {
  downloading: "Descargando footage",
  metadata: "Leyendo metadata",
  detecting_silences: "Detectando silencios",
  rendering: "Cortando y montando",
  uploading: "Subiendo resultado",
  done: "Terminado",
};

const STEP_ORDER = ["downloading", "metadata", "detecting_silences", "rendering", "uploading", "done"];

export default function MontajeDetailPage() {
  const params = useParams<{ id: string }>();
  const [montaje, setMontaje] = useState<MontajeStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/montaje/${params.id}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "No se pudo cargar el montaje");
        }
        const data = (await res.json()) as MontajeStatus;
        if (!cancelled) setMontaje(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Error");
      }
    };

    fetchStatus();
    const interval = setInterval(() => {
      if (montaje?.status === "completed" || montaje?.status === "error") {
        clearInterval(interval);
        return;
      }
      fetchStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [params.id, montaje?.status]);

  if (loadError) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  if (!montaje) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Cargando…</p>
      </div>
    );
  }

  const completed = montaje.status === "completed";
  const errored = montaje.status === "error";
  const currentStepIdx = montaje.step ? STEP_ORDER.indexOf(montaje.step) : -1;
  const ahorroSeg =
    montaje.duracionOriginalSeg - montaje.duracionFinalSeg;
  const ahorroPct =
    montaje.duracionOriginalSeg > 0
      ? (ahorroSeg / montaje.duracionOriginalSeg) * 100
      : 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title={montaje.nombre} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Progreso</h2>
            <Badge status={montaje.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {STEP_ORDER.map((stepKey, idx) => {
              const isDone = completed || idx < currentStepIdx;
              const isCurrent = !completed && idx === currentStepIdx;
              return (
                <li
                  key={stepKey}
                  className="flex items-center gap-3 text-sm text-gray-600"
                >
                  <span
                    className={[
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      isDone
                        ? "bg-green-100 text-green-700"
                        : isCurrent
                        ? "bg-indigo-100 text-indigo-700 animate-pulse"
                        : "bg-gray-100 text-gray-400",
                    ].join(" ")}
                  >
                    {idx + 1}
                  </span>
                  {STEP_LABELS[stepKey] ?? stepKey}
                </li>
              );
            })}
          </ul>

          {errored && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <strong>Error:</strong> {montaje.errorMessage ?? "Error desconocido"}
            </div>
          )}
        </CardContent>
      </Card>

      {completed && montaje.videoFinalUrl && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Resultado</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">Duración original</p>
                <p className="font-medium text-gray-900">
                  {montaje.duracionOriginalSeg.toFixed(1)} s
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Duración final</p>
                <p className="font-medium text-gray-900">
                  {montaje.duracionFinalSeg.toFixed(1)} s
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Silencios cortados</p>
                <p className="font-medium text-gray-900">
                  {montaje.silenciosCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Ahorro</p>
                <p className="font-medium text-green-700">
                  {ahorroSeg.toFixed(1)} s ({ahorroPct.toFixed(0)}%)
                </p>
              </div>
            </div>

            <div className="rounded-lg overflow-hidden bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={montaje.videoFinalUrl}
                controls
                className="w-full max-h-[60vh]"
              />
            </div>

            <a
              href={montaje.videoFinalUrl}
              download={`${montaje.nombre}.mp4`}
              className="block"
            >
              <Button className="w-full">Descargar MP4 final</Button>
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
