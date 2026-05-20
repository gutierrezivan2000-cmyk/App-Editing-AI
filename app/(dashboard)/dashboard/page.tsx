import { Header } from "@/components/dashboard/Header";
import { MetricsCard } from "@/components/dashboard/MetricsCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RenderMethodChip } from "@/components/proyectos/RenderMethodChip";
import { getAllProyectos, getProyectosMetrics } from "@/lib/db";
import { auth } from "@/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const [metrics, proyectos] = await Promise.all([
    getProyectosMetrics(userId),
    getAllProyectos(userId),
  ]);

  const recientes = proyectos.slice(0, 8);

  return (
    <div className="flex flex-col">
      <Header
        title="Dashboard"
        description="Panorama general de los proyectos activos."
        actions={
          <Link href="/dashboard/proyectos/nuevo">
            <Button size="sm">
              <PlusIcon className="h-4 w-4" />
              <span>Nuevo proyecto</span>
            </Button>
          </Link>
        }
      />

      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricsCard
            label="Total proyectos"
            value={metrics.total}
            tone="info"
            icon={<FolderIcon className="h-5 w-5" />}
          />
          <MetricsCard
            label="Completados hoy"
            value={metrics.completedToday}
            tone="success"
            icon={<CheckIcon className="h-5 w-5" />}
          />
          <MetricsCard
            label="En proceso"
            value={metrics.processing}
            tone="warning"
            icon={<ClockIcon className="h-5 w-5" />}
          />
          <MetricsCard
            label="Errores"
            value={metrics.errors}
            tone="danger"
            icon={<AlertIcon className="h-5 w-5" />}
          />
        </div>

        {/* Proyectos recientes */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Proyectos recientes
              </h2>
              <p className="text-xs text-gray-500">
                Últimos {Math.min(recientes.length, 8)} de {proyectos.length} proyectos
              </p>
            </div>
            <Link
              href="/dashboard/proyectos"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Ver todos →
            </Link>
          </div>

          {recientes.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-gray-100">
              {recientes.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/dashboard/proyectos/${p.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50"
                  >
                    <RenderMethodChip method={p.renderMethod} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {p.nombre}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        Cliente: {p.clienteId} ·{" "}
                        {p.createdAt.toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <Badge status={p.status} />
                    <ChevronRightIcon className="h-4 w-4 flex-shrink-0 text-gray-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
        <FolderIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        Sin proyectos todavía
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Subí uno o varios clips, dale un brief y dejá que la IA arme el
        video. El primer proyecto tarda ~2-3 minutos.
      </p>
      <Link href="/dashboard/proyectos/nuevo" className="mt-5">
        <Button size="sm">
          <PlusIcon className="h-4 w-4" />
          Crear el primero
        </Button>
      </Link>
    </div>
  );
}

// ─── Iconos SVG ──────────────────────────────────────────────────────

function FolderIcon({ className }: { className?: string }) {
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
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
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
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
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
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
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
      <path d="M12 5v14" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
