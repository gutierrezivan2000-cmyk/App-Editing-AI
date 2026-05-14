import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getAllMontajes } from "@/lib/montajes-db";

export const dynamic = "force-dynamic";

export default async function MontajeListPage() {
  let montajes: Awaited<ReturnType<typeof getAllMontajes>> = [];
  let dbError: string | null = null;

  try {
    montajes = await getAllMontajes();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Header title="Montaje automático" />
        <Link href="/dashboard/montaje/nuevo">
          <Button>Nuevo montaje</Button>
        </Link>
      </div>

      <p className="text-sm text-gray-500 max-w-2xl">
        Sube un video, detectamos los silencios y te devolvemos el MP4 ya
        cortado y montado — listo para publicar. Sin XML, sin importar a Premiere:
        un único video final.
      </p>

      {dbError && (
        <Card>
          <CardContent>
            <p className="text-sm text-red-600">
              Error al cargar montajes: {dbError}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              ¿La tabla <code>montajes</code> no existe? Ejecuta{" "}
              <code>POST /api/migrate</code> con el header{" "}
              <code>x-admin-secret: $AUTH_SECRET</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {!dbError && montajes.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-sm text-gray-500 text-center py-8">
              No hay montajes todavía. Crea uno para empezar.
            </p>
          </CardContent>
        </Card>
      )}

      {montajes.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Nombre</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Estado</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Silencios</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Segmentos</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Original</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">Final</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {montajes.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{m.nombre}</td>
                    <td className="px-4 py-2">
                      <Badge status={m.status} />
                    </td>
                    <td className="px-4 py-2 text-gray-600">{m.silenciosCount}</td>
                    <td className="px-4 py-2 text-gray-600">{m.segmentsCount}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {m.duracionOriginalSeg > 0
                        ? `${m.duracionOriginalSeg.toFixed(1)} s`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {m.duracionFinalSeg > 0
                        ? `${m.duracionFinalSeg.toFixed(1)} s`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/dashboard/montaje/${m.id}`}
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
