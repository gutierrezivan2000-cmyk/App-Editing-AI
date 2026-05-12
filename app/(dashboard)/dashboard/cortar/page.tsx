import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
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
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Header title="Cortar silencios → XML Premiere" />
        <Link href="/dashboard/cortar/nuevo">
          <Button>Nuevo corte</Button>
        </Link>
      </div>

      <p className="text-sm text-gray-500 max-w-2xl">
        Sube un video, detecta los silencios y descarga un XML editable
        directamente importable en Premiere Pro. Sin subtítulos, sin IA — solo
        cortes.
      </p>

      {dbError && (
        <Card>
          <CardContent>
            <p className="text-sm text-red-600">
              Error al cargar cortes: {dbError}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              ¿La tabla <code>cortes</code> no existe? Ejecuta:{" "}
              <code>POST /api/migrate</code> con el header{" "}
              <code>x-admin-secret: $AUTH_SECRET</code>
            </p>
          </CardContent>
        </Card>
      )}

      {!dbError && cortes.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-sm text-gray-500 text-center py-8">
              No hay cortes todavía. Crea uno para empezar.
            </p>
          </CardContent>
        </Card>
      )}

      {cortes.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Nombre</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Estado</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Silencios</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Segmentos</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Duración</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {cortes.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.nombre}</td>
                    <td className="px-4 py-2">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-4 py-2 text-gray-600">{c.silenciosCount}</td>
                    <td className="px-4 py-2 text-gray-600">{c.segmentsCount}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {c.duracionSeg > 0 ? `${c.duracionSeg.toFixed(1)} s` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/dashboard/cortar/${c.id}`}
                        className="text-indigo-600 hover:text-indigo-800 text-xs"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
