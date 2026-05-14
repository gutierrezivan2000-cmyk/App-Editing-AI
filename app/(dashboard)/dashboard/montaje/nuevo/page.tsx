"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { UploadZone } from "@/components/proyectos/UploadZone";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

export default function NuevoMontajePage() {
  const router = useRouter();
  const [footageUrl, setFootageUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!footageUrl) {
      setError("Primero sube el video.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/montaje", {
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? data.error ?? "Error al encolar");
      }

      const { montajeId } = await res.json();
      router.push(`/dashboard/montaje/${montajeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title="Nuevo montaje" />

      <p className="text-sm text-gray-500 max-w-2xl">
        Detectamos los silencios, los recortamos y montamos el video final en
        MP4. Cuando termine, podrás reproducirlo y descargarlo directamente.
      </p>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Información</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="nombre">Nombre del montaje</Label>
              <Input
                id="nombre"
                name="nombre"
                placeholder="Reel 5 — entrevista"
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Footage</h2>
          </CardHeader>
          <CardContent>
            <UploadZone onUploaded={setFootageUrl} />
            <p className="mt-2 text-xs text-gray-400">
              Máximo recomendado: 200 MB / 10 minutos. Videos más largos pueden
              superar el límite de procesamiento.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">
              Parámetros de detección
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label htmlFor="umbralDb">Umbral (dB)</Label>
                <Input
                  id="umbralDb"
                  name="umbralDb"
                  type="number"
                  step="1"
                  defaultValue={-30}
                />
                <p className="text-xs text-gray-400">
                  Más bajo = más sensible (típico: -30 a -45)
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="duracionMinima">Duración mínima (s)</Label>
                <Input
                  id="duracionMinima"
                  name="duracionMinima"
                  type="number"
                  step="0.1"
                  defaultValue={0.5}
                />
                <p className="text-xs text-gray-400">
                  Silencios más cortos se ignoran
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="margenSeg">Margen (s)</Label>
                <Input
                  id="margenSeg"
                  name="margenSeg"
                  type="number"
                  step="0.01"
                  defaultValue={0.05}
                />
                <p className="text-xs text-gray-400">
                  Padding antes/después del corte
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button type="submit" loading={submitting} disabled={!footageUrl}>
          Encolar montaje
        </Button>
      </form>
    </div>
  );
}
