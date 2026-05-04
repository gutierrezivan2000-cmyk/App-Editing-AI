import { put, del } from "@vercel/blob";
import type { Sandbox } from "@vercel/sandbox";
import { runInSandbox } from "./sandbox";

export async function uploadToBlob(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { url } = await put(key, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
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

export async function uploadFromSandboxToBlob(
  sandbox: Sandbox,
  sandboxFilePath: string,
  blobPath: string
): Promise<string> {
  const { stdout, exitCode, stderr } = await runInSandbox(
    sandbox,
    `base64 -w 0 "${sandboxFilePath}"`
  );
  if (exitCode !== 0) {
    throw new Error(`No se pudo leer ${sandboxFilePath} del sandbox (exit ${exitCode}): ${stderr.slice(-300)}`);
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`Archivo vacío en sandbox: ${sandboxFilePath}`);
  }
  const buffer = Buffer.from(trimmed, "base64");
  const contentType = blobPath.endsWith(".mp4") ? "video/mp4"
    : blobPath.endsWith(".mp3") ? "audio/mpeg"
    : "application/octet-stream";
  return uploadToBlob(blobPath, buffer, contentType);
}
