import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { getLocalFilename } from "@/lib/premiere-xml";

type DownloadType = "xml" | "edl" | "capcut" | "footage" | "output";

function isDownloadType(value: string | null): value is DownloadType {
  return (
    value === "xml" ||
    value === "edl" ||
    value === "capcut" ||
    value === "footage" ||
    value === "output"
  );
}

function rfc5987Encode(str: string): string {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (!isDownloadType(type)) {
    return NextResponse.json(
      { error: "Parámetro 'type' debe ser xml | edl | capcut | footage | output" },
      { status: 400 }
    );
  }

  let project;
  try {
    project = await getProject(projectId);
  } catch {
    return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  }

  let blobUrl: string | undefined;
  let filename: string;

  if (type === "xml") {
    blobUrl = project.xmlUrl;
    filename = `${project.nombre}.xml`;
  } else if (type === "edl") {
    blobUrl = project.edlUrl;
    filename = `${project.nombre}.edl`;
  } else if (type === "capcut") {
    blobUrl = project.capcutUrl;
    filename = `${project.nombre}_CapCut.zip`;
  } else if (type === "output") {
    blobUrl = project.outputUrl;
    filename = `${project.nombre}_final.mp4`;
  } else {
    blobUrl = project.footageUrl;
    filename = getLocalFilename(project.nombre, project.footageUrl);
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
