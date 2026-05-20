import { put, del } from "@vercel/blob";
import type { Sandbox } from "@vercel/sandbox";
import { uploadSandboxFileToBlob } from "./sandbox";

export async function uploadToBlob(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { url } = await put(key, buffer, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    allowOverwrite: true,
  });
  return url;
}

export async function downloadFromBlob(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar blob ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteFromBlob(url: string): Promise<void> {
  await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
}

/**
 * Sube un archivo desde dentro del sandbox al Vercel Blob.
 *
 * Delega al helper `uploadSandboxFileToBlob` en lib/sandbox.ts — ese
 * helper se encarga de:
 *   - instalar @vercel/blob en el sandbox si falta
 *   - escribir /tmp/upload-blob.mjs si falta
 *   - ejecutar el script con node y parsear la respuesta
 *   - pasar allowOverwrite: true para que los reintentos funcionen
 *
 * Historia del bug que motivo este wrapper en lib/blob.ts:
 *   v1-v4 — multiples versiones que intentaban pasar el binario por
 *     stdout (base64 / cat). Todas rompian con archivos grandes porque
 *     el SDK de Vercel Sandbox no puede serializar strings > ~70MB.
 *   v5 — usar @remotion/vercel:uploadToVercelBlob. Funcionaba pero
 *     fallaba en sandboxes que no tenian su script preinstalado, y NO
 *     pasaba allowOverwrite (reintentos rompian).
 *   v6 (esta) — helper propio compartido entre lib/blob.ts y lib/render.ts.
 */
export async function uploadFromSandboxToBlob(
  sandbox: Sandbox,
  sandboxFilePath: string,
  blobPath: string
): Promise<string> {
  const contentType = blobPath.endsWith(".mp4")
    ? "video/mp4"
    : blobPath.endsWith(".mp3")
      ? "audio/mpeg"
      : "application/octet-stream";
  return uploadSandboxFileToBlob(sandbox, sandboxFilePath, blobPath, contentType);
}
