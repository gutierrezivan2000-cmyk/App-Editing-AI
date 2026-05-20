import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Endpoint que emite tokens firmados para upload directo a Vercel Blob.
 *
 * Defensas en capas (cliente + server):
 *  - Cliente (MultiUploadZone.tsx + UploadZone.tsx):
 *      `accept="video/*"` en el <input>, `file.type.startsWith("video/")`
 *      en el handler, check de tamaño en MB.
 *  - Server (acá):
 *      1. `requireAuth()` para que solo usuarios autenticados consuman
 *         la cuota de Blob.
 *      2. `maximumSizeInBytes: 500 MB` enforzado por Vercel a nivel red.
 *      3. `addRandomSuffix: true` para evitar colisiones de path entre
 *         subidas concurrentes.
 *
 * NO usamos `allowedContentTypes` porque Vercel Blob NO soporta wildcards
 * ahí (espera MIMEs específicos). Listar todos los MIMEs de video que un
 * navegador puede mandar es frágil — el cliente a veces emite
 * `application/octet-stream` para archivos sin MIME claro, y rechazarlos
 * romperia uploads legítimos.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log("[upload] completed", blob.url, "by user", session.user.id);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("[upload]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al subir" },
      { status: 400 }
    );
  }
}
