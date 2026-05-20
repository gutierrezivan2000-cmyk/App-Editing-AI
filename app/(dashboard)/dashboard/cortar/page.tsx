import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { getAllCortes } from "@/lib/cortes-db";

export const dynamic = "force-dynamic";

export default async function CortarListPage() {
  let cortes: Awaited<ReturnType<typeof getAllCortes>> = [];
  let dbError: string | null = null;

  try {
    cortes = await getAllCortes();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex flex-col">
      <Header
        title="Cortar silencios"
        description="Subí un video, detectá los silencios y descargá un XML / EDL / CapCut editable. Sin IA, solo cortes mecánicos."
        actions={
          <Link href="/dashboard/cortar/nuevo">
            <Button size="sm">
              <PlusIcon className="h-4 w-4" />
              Nuevo corte
            </Button>
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {dbError && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              No se pudo cargar la lista de cortes
            </p>
            <p className="mt-1 text-xs text-amber-700">{dbError}</p>
            <p className="mt-2 text-xs text-amber-600">
              ¿La tabla <code className="font-mono">cortes</code> no existe?
              Ejecutá <code className="font-mono">POST /api/migrate</code> con el
              header <code className="font-mono">x-admin-secret</code>.
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {!dbError && cortes.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-gray-100">
              {cortes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/cortar/${c.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                      <ScissorsIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {c.nombre}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {c.duracionSeg > 0
                          ? `${c.duracionSeg.toFixed(1)} s · `
                          : ""}
                        {c.silenciosCount} silencio
                        {c.silenciosCount === 1 ? "" : "s"} · {c.segmentsCount}{" "}
                        segmento{c.segmentsCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge status={c.status} />
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
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-500">
        <ScissorsIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        Sin cortes todavía
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Cargá un video y la app detecta los silencios automáticamente. Te
        entrega un XML para Premiere, EDL para DaVinci o un proyecto CapCut.
      </p>
      <Link href="/dashboard/cortar/nuevo" className="mt-5">
        <Button size="sm">
          <PlusIcon className="h-4 w-4" />
          Crear el primero
        </Button>
      </Link>
    </div>
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

function ScissorsIcon({ className }: { className?: string }) {
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
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}
