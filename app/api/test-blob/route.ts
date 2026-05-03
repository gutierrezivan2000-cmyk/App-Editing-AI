import { put, list } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return NextResponse.json({ ok: false, error: "BLOB_READ_WRITE_TOKEN no está configurado" });
  }

  const tokenPreview = `${token.substring(0, 30)}...`;

  try {
    // Try a tiny server-side put to verify the token works end-to-end
    const testBlob = await put(
      "test/ping.txt",
      "ping",
      { access: "public", addRandomSuffix: false, token }
    );
    return NextResponse.json({
      ok: true,
      tokenPreview,
      testUrl: testBlob.url,
      message: "BLOB_READ_WRITE_TOKEN funciona correctamente server-side",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      tokenPreview,
      error: message,
    });
  }
}
