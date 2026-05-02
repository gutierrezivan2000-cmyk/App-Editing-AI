import { NextResponse } from "next/server";
import { uploadToBlob } from "@/lib/blob";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Solo se aceptan archivos de video" },
        { status: 400 }
      );
    }

    const maxSize = 500 * 1024 * 1024; // 500 MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "El archivo excede el tamaño máximo de 500 MB" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() ?? "mp4";
    const key = `footage/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const url = await uploadToBlob(key, buffer, file.type);
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    console.error("[upload/route]", error);
    return NextResponse.json(
      { error: "Error al subir el archivo" },
      { status: 500 }
    );
  }
}
