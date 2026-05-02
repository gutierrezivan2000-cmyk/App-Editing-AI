import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getAllClientes } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const clientes = await getAllClientes();

  return (
    <div className="space-y-6 p-6">
      <Header title="Clientes" />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{clientes.length} clientes</p>
        <Link href="/dashboard/clientes/nuevo">
          <Button size="sm">+ Nuevo cliente</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clientes.length === 0 ? (
          <p className="col-span-full text-center text-sm text-gray-400 py-10">
            No hay clientes. Crea el primero.
          </p>
        ) : (
          clientes.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{c.nombre}</p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{c.id}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.redes.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Link href={`/dashboard/clientes/${c.id}`}>
                    <Button variant="ghost" size="sm">
                      Editar
                    </Button>
                  </Link>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                  <span
                    className="h-3 w-3 rounded-full border border-gray-200"
                    style={{ backgroundColor: c.subtitulos.color_base }}
                  />
                  <span
                    className="h-3 w-3 rounded-full border border-gray-200"
                    style={{ backgroundColor: c.subtitulos.color_enfasis }}
                  />
                  <span>{c.subtitulos.animacion}</span>
                  <span>·</span>
                  <span>{c.subtitulos.palabras_por_linea} palabras/línea</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
