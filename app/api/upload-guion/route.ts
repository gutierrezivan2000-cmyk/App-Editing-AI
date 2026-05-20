import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireAuth } from "@/lib/api-auth";

/**
 * Parser de archivos de guión. Acepta multipart/form-data con un solo file
 * en el campo "file". Devuelve { text: string } con el contenido extraído.
 *
 * Formatos soportados: .txt, .docx, .pdf.
 */
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — los guiones de texto rara vez pesan más.

export async function POST(req: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body no es multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Falta el archivo en el campo 'file'" },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `El archivo excede ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 }
    );
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let text = "";
    if (name.endsWith(".txt") || file.type.startsWith("text/")) {
      text = buffer.toString("utf-8");
    } else if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (name.endsWith(".pdf")) {
      // pdf-parse needs CommonJS-style require; dynamic import to avoid the
      // self-test that hits a sample PDF on module init.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfMod = await import("pdf-parse") as any;
      const pdfParse = pdfMod.default ?? pdfMod;
      const result = await pdfParse(buffer);
      text = result.text;
    } else {
      return NextResponse.json(
        { error: "Formato no soportado. Usa .txt, .docx o .pdf" },
        { status: 415 }
      );
    }

    // Normalizar: limpiar dobles espacios, normalizar saltos de línea.
    const cleaned = text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return NextResponse.json({ text: cleaned, bytes: file.size, name: file.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[upload-guion]", msg);
    return NextResponse.json(
      { error: `No se pudo parsear el archivo: ${msg}` },
      { status: 500 }
    );
  }
}
