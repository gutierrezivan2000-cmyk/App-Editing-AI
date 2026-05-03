import { Header } from "@/components/dashboard/Header";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getAllProyectos } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProyectosPage() {
  const proyectos = await getAllProyectos();

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title="Proyectos" />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{proyectos.length} proyectos</p>
        <Link href="/dashboard/proyectos/nuevo">
          <Button size="sm">+ Nuevo proyecto</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900">Todos los proyectos</h2>
        </CardHeader>
        <CardContent className="p-0">
          {proyectos.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-400">
              Sin proyectos aún.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">Nombre</th>
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3">Actualizado</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {proyectos.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-gray-900">{p.nombre}</td>
                    <td className="px-6 py-3 text-gray-500">{p.clienteId}</td>
                    <td className="px-6 py-3">
                      <Badge status={p.status} />
                    </td>
                    <td className="px-6 py-3 text-gray-400">
                      {p.updatedAt.toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        href={`/dashboard/proyectos/${p.id}`}
                        className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
