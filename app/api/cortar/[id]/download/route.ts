import { NextResponse } from "next/server";
import { getCorte } from "@/lib/cortes-db";
import { getLocalFilename } from "@/lib/premiere-xml";

type DownloadType = "xml" | "edl" | "capcut" | "footage";

function isDownloadType(value: string | null): value is DownloadType {
  return (
    value === "xml" ||
    value === "edl" ||
    value === "capcut" ||
    value === "footage"
  );
}

function rfc5987Encode(str: string): string {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (!isDownloadType(type)) {
    return NextResponse.json(
      { error: "Parámetro 'type' debe ser xml | edl | capcut | footage" },
      { status: 400 }
    );
  }

  let corte;
  try {
    corte = await getCorte(id);
  } catch {
    return NextResponse.json({ error: "Corte no encontrado" }, { status: 404 });
  }

  let blobUrl: string | undefined;
  let filename: string;

  if (type === "xml") {
    blobUrl = corte.xmlUrl;
    filename = `${corte.nombre}.xml`;
  } else if (type === "edl") {
    blobUrl = corte.edlUrl;
    filename = `${corte.nombre}.edl`;
  } else if (type === "capcut") {
    blobUrl = corte.capcutUrl;
    filename = `${corte.nombre}_CapCut.zip`;
  } else {
    blobUrl = corte.footageUrl;
    filename = getLocalFilename(corte.nombre, corte.footageUrl);
  }

  if (!blobUrl) {
    return NextResponse.json(
      { error: `Archivo ${type} aún no disponible` },
      { status: 404 }
    );
  }

  const blobRes = await fetch(blobUrl);
  if (!blobRes.ok || !blobRes.body) {
    return NextResponse.json(
      { error: `No se pudo descargar el blob (${blobRes.status})` },
      { status: 502 }
    );
  }

  const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const headers = new Headers();
  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${rfc5987Encode(filename)}`
  );
  headers.set(
    "Content-Type",
    blobRes.headers.get("content-type") ?? "application/octet-stream"
  );
  const len = blobRes.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new NextResponse(blobRes.body, { status: 200, headers });
}
