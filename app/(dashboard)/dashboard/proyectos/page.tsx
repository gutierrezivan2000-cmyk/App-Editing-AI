import { Header } from "@/components/dashboard/Header";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { RenderMethodChip } from "@/components/proyectos/RenderMethodChip";
import { getAllProyectos } from "@/lib/db";
import { auth } from "@/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProyectosPage() {
  const session = await auth();
  const proyectos = await getAllProyectos(session?.user?.id);

  const enProceso = proyectos.filter((p) => p.status === "processing").length;
  const completados = proyectos.filter((p) => p.status === "completed").length;
  const conError = proyectos.filter((p) => p.status === "error").length;

  return (
    <div className="flex flex-col">
      <Header
        title="Proyectos"
        description={`${proyectos.length} proyectos en total · ${enProceso} en proceso · ${completados} completados · ${conError} con error`}
        actions={
          <Link href="/dashboard/proyectos/nuevo">
            <Button size="sm">
              <PlusIcon className="h-4 w-4" />
              Nuevo proyecto
            </Button>
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {proyectos.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-gray-100">
              {proyectos.map((p) => (
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
                        Cliente: {p.clienteId} · Actualizado{" "}
                        {formatRelative(p.updatedAt)}
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
        <FilmIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        Sin proyectos todavía
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Cada proyecto representa un video editado por la IA. Empezá subiendo
        material y la app se encarga del resto.
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

/**
 * Formato "hace X" para la fecha de actualizacion en la lista. Mas humano
 * que un toLocaleDateString suelto. Cubre los rangos comunes.
 */
function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `hace ${day} d`;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

function FilmIcon({ className }: { className?: string }) {
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
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M3 7.5h4" />
      <path d="M3 12h18" />
      <path d="M3 16.5h4" />
      <path d="M17 7.5h4" />
      <path d="M17 16.5h4" />
    </svg>
  );
}
