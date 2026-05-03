import { Header } from "@/components/dashboard/Header";
import { MetricsCard } from "@/components/dashboard/MetricsCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getAllProyectos, getProyectosMetrics } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [metrics, proyectos] = await Promise.all([
    getProyectosMetrics(),
    getAllProyectos(),
  ]);

  const recientes = proyectos.slice(0, 8);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Header title="Dashboard" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricsCard
          label="Total proyectos"
          value={metrics.total}
          icon="📁"
        />
        <MetricsCard
          label="Completados hoy"
          value={metrics.completedToday}
          icon="✅"
        />
        <MetricsCard
          label="En proceso"
          value={metrics.processing}
          icon="⚙️"
        />
        <MetricsCard
          label="Errores"
          value={metrics.errors}
          icon="⚠️"
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900">
            Proyectos recientes
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {recientes.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-gray-400">
              No hay proyectos todavía.{" "}
              <Link href="/dashboard/proyectos/nuevo" className="text-indigo-600 hover:underline">
                Crear el primero
              </Link>
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3">Nombre</th>
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recientes.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <Link
                        href={`/dashboard/proyectos/${p.id}`}
                        className="font-medium text-gray-900 hover:text-indigo-600"
                      >
                        {p.nombre}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-gray-500">{p.clienteId}</td>
                    <td className="px-6 py-3">
                      <Badge status={p.status} />
                    </td>
                    <td className="px-6 py-3 text-gray-400">
                      {p.createdAt.toLocaleDateString("es-ES")}
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
