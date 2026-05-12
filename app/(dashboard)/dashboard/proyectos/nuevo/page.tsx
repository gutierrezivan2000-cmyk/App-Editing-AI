"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { UploadZone } from "@/components/proyectos/UploadZone";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

export default function NuevoProyectoPage() {
  const router = useRouter();
  const [footageUrl, setFootageUrl] = useState<string | null>(null);
  const [renderMethod, setRenderMethod] = useState<"original" | "mirage">("original");
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
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: form.get("clienteId") as string,
          nombre: form.get("nombre") as string,
          brief: form.get("brief") as string,
          footageUrl,
          renderMethod,
          clickupTaskId: (form.get("clickupTaskId") as string) || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al encolar el proyecto");
      }

      const { projectId } = await res.json();
      router.push(`/dashboard/proyectos/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title="Nuevo proyecto" />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Información del proyecto</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="nombre">Nombre del proyecto</Label>
              <Input id="nombre" name="nombre" placeholder="Ep. 5 — Entrevista startup" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clienteId">ID del cliente</Label>
              <Input
                id="clienteId"
                name="clienteId"
                placeholder="cliente-demo"
                defaultValue="cliente-demo"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clickupTaskId">ID tarea ClickUp (opcional)</Label>
              <Input id="clickupTaskId" name="clickupTaskId" placeholder="abc123" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Footage</h2>
          </CardHeader>
          <CardContent>
            <UploadZone onUploaded={setFootageUrl} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Método de render</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:bg-gray-50 transition-colors"
              style={{ borderColor: renderMethod === "original" ? "#1a73e8" : "#e5e7eb", background: renderMethod === "original" ? "#eff6ff" : undefined }}>
              <input
                type="radio"
                name="renderMethod"
                value="original"
                checked={renderMethod === "original"}
                onChange={() => setRenderMethod("original")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Original — Whisper + Remotion</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Transcripción con Whisper, Claude decide énfasis y animación, Remotion renderiza subtítulos dinámicos.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:bg-gray-50 transition-colors"
              style={{ borderColor: renderMethod === "mirage" ? "#1a73e8" : "#e5e7eb", background: renderMethod === "mirage" ? "#eff6ff" : undefined }}>
              <input
                type="radio"
                name="renderMethod"
                value="mirage"
                checked={renderMethod === "mirage"}
                onChange={() => setRenderMethod("mirage")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Mirage — Captions.ai</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Subtítulos automáticos vía Captions.ai. Más rápido, sin Whisper ni Remotion. Requiere{" "}
                  <code className="bg-gray-100 px-1 rounded text-xs">MIRAGE_API_KEY</code> configurada.
                  Límite: 50 MB / 1 min / formato 9:16.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Brief para Claude</h2>
          </CardHeader>
          <CardContent>
            <Textarea
              name="brief"
              rows={6}
              placeholder="Describe el objetivo del video, palabras clave a enfatizar, tono, CTA, etc."
              required
            />
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <Button type="submit" loading={submitting} disabled={!footageUrl}>
          Encolar pipeline
        </Button>
      </form>
    </div>
  );
}
