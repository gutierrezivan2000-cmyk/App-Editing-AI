import { notFound } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { PipelineStatus } from "@/components/proyectos/PipelineStatus";
import { VideoPreview } from "@/components/proyectos/VideoPreview";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getProject } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProyectoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let proyecto;
  try {
    proyecto = await getProject(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title={proyecto.nombre} />

      <div className="flex items-center gap-3">
        <Badge status={proyecto.status} />
        <span className="text-sm text-gray-400">
          Actualizado: {proyecto.updatedAt.toLocaleString("es-ES")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Estado del pipeline</h2>
          </CardHeader>
          <CardContent>
            <PipelineStatus
              projectId={proyecto.id}
              initialStatus={proyecto.status}
              renderMethod={proyecto.renderMethod}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">Información</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-gray-400">Cliente</p>
              <p className="font-medium text-gray-900">{proyecto.clienteId}</p>
            </div>
            <div>
              <p className="text-gray-400">Brief</p>
              <p className="text-gray-700 whitespace-pre-wrap">{proyecto.brief}</p>
            </div>
            {proyecto.clickupTaskId && (
              <div>
                <p className="text-gray-400">ClickUp Task ID</p>
                <p className="font-mono text-gray-700">{proyecto.clickupTaskId}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {proyecto.renderMethod !== "cortes" && proyecto.status === "completed" && proyecto.outputUrl && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Video final</h2>
              <a href={`/api/pipeline/${proyecto.id}/download?type=output`}>
                <Button size="sm" variant="secondary">
                  ⬇ Descargar
                </Button>
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <VideoPreview outputUrl={proyecto.outputUrl} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
