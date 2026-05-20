import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { PipelineStatus } from "@/components/proyectos/PipelineStatus";
import { RenderMethodChip } from "@/components/proyectos/RenderMethodChip";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getProject } from "@/lib/db";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function ProyectoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Filtramos por userId para que la URL `/dashboard/proyectos/<id>` con un
  // id ajeno responda 404 igual que si no existiera.
  const session = await auth();
  let proyecto;
  try {
    proyecto = await getProject(id, session?.user?.id);
  } catch {
    notFound();
  }

  const updatedAt = proyecto.updatedAt.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col">
      <Header
        title={proyecto.nombre}
        description={`Actualizado ${updatedAt}`}
        actions={
          <div className="flex items-center gap-3">
            {/* Boton "Abrir editor" solo disponible cuando el proyecto
                multiclip ya termino. Lleva a la vista de edicion en vivo
                con Remotion Player + paneles de subtitulos/enfasis/snippets. */}
            {proyecto.renderMethod === "multiclip" &&
              proyecto.status === "completed" && (
                <Link href={`/dashboard/proyectos/${proyecto.id}/editor`}>
                  <Button size="sm">
                    <EditIcon className="h-4 w-4" />
                    Abrir editor
                  </Button>
                </Link>
              )}
            <Link
              href="/dashboard/proyectos"
              className="text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              ← Todos los proyectos
            </Link>
          </div>
        }
      />

      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        {/* Bandeja de metadatos arriba: modo + status */}
        <div className="flex flex-wrap items-center gap-2">
          <RenderMethodChip method={proyecto.renderMethod} size="sm" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Columna principal: estado del pipeline */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-gray-900">
                Estado del pipeline
              </h2>
            </CardHeader>
            <CardContent>
              <PipelineStatus
                projectId={proyecto.id}
                initialStatus={proyecto.status}
                renderMethod={proyecto.renderMethod}
              />
            </CardContent>
          </Card>

          {/* Sidebar derecha: contexto del proyecto */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900">
                  Información
                </h2>
              </CardHeader>
              <CardContent className="space-y-3.5 text-sm">
                <Field label="Cliente" value={proyecto.clienteId} mono />
                <Field
                  label="Modo de pipeline"
                  value={describeRenderMethod(proyecto.renderMethod)}
                />
                {proyecto.clickupTaskId && (
                  <Field
                    label="ClickUp Task"
                    value={proyecto.clickupTaskId}
                    mono
                  />
                )}
                {proyecto.brief && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Brief
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">
                      {proyecto.brief}
                    </p>
                  </div>
                )}
                {proyecto.guion && (
                  <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-wide text-gray-500 hover:text-gray-700">
                      <span>Guión</span>
                      <span className="text-[10px] text-gray-400 group-open:rotate-180 transition-transform">
                        ▼
                      </span>
                    </summary>
                    <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                      {proyecto.guion}
                    </p>
                  </details>
                )}
                {proyecto.clips && proyecto.clips.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">
                      Clips fuente ({proyecto.clips.length})
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {proyecto.clips.map((c, idx) => (
                        <li
                          key={idx}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="font-mono tabular-nums text-gray-400">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="truncate text-gray-700">
                            {c.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={
          mono
            ? "mt-0.5 font-mono text-xs text-gray-700"
            : "mt-0.5 text-gray-900"
        }
      >
        {value}
      </p>
    </div>
  );
}

function describeRenderMethod(m: string): string {
  switch (m) {
    case "multiclip":
      return "Multiclip — orden y cortes decididos por IA";
    case "cortes":
      return "Cortes IA — solo entrega de project files";
    case "mirage":
      return "Mirage — subtítulos via API externa";
    default:
      return "Original — render completo con Remotion";
  }
}

function EditIcon({ className }: { className?: string }) {
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
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}
