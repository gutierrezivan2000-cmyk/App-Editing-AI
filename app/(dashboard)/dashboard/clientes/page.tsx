import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { getAllClientes } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const clientes = await getAllClientes();

  return (
    <div className="flex flex-col">
      <Header
        title="Clientes"
        description={`${clientes.length} ${
          clientes.length === 1 ? "cliente" : "clientes"
        } configurados`}
        actions={
          <Link href="/dashboard/clientes/nuevo">
            <Button size="sm">
              <PlusIcon className="h-4 w-4" />
              Nuevo cliente
            </Button>
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        {clientes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clientes.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/clientes/${c.id}`}
                className="group rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-semibold text-white shadow-sm">
                    {getInitials(c.nombre)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-700">
                      {c.nombre}
                    </p>
                    <p className="truncate font-mono text-xs text-gray-400">
                      {c.id}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {c.redes.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
                    >
                      {redLabel(r)}
                    </span>
                  ))}
                </div>

                {/* Brand-kit preview */}
                <div className="mt-4 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <ColorSwatch color={c.subtitulos.color_base} />
                    <ColorSwatch color={c.subtitulos.color_enfasis} />
                    <span className="ml-1 text-gray-500">
                      {c.subtitulos.fuente_principal}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                  <span className="inline-flex items-center gap-1">
                    <SparklesIcon className="h-3 w-3" />
                    {c.subtitulos.animacion}
                  </span>
                  <span>·</span>
                  <span>{c.subtitulos.palabras_por_linea} palabras/línea</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
        <UsersIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        Aún no hay clientes
      </h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Cada cliente tiene su brand-kit: tipografías, colores, animación de
        subtítulos, formatos de exportación. Configurá uno para empezar.
      </p>
      <Link href="/dashboard/clientes/nuevo" className="mt-5">
        <Button size="sm">
          <PlusIcon className="h-4 w-4" />
          Crear el primero
        </Button>
      </Link>
    </div>
  );
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-4 w-4 rounded border border-gray-200 shadow-inner"
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function redLabel(red: string): string {
  const map: Record<string, string> = {
    instagram_reels: "Reels",
    instagram_stories: "Stories",
    tiktok: "TikTok",
    youtube_shorts: "Shorts",
  };
  return map[red] ?? red;
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

function UsersIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
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
      <path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5L12 3z" />
      <path d="M19 16l-.5 1.5L17 18l1.5.5L19 20l.5-1.5L21 18l-1.5-.5L19 16z" />
      <path d="M5 5l-.5 1.5L3 7l1.5.5L5 9l.5-1.5L7 7l-1.5-.5L5 5z" />
    </svg>
  );
}
