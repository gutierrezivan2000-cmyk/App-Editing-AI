import { NextResponse } from "next/server";
import { createCorte, getAllCortes } from "@/lib/cortes-db";
import { inngest } from "@/inngest/client";
import { ratelimit } from "@/lib/ratelimit";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    if (ratelimit) {
      const ip = req.headers.get("x-forwarded-for") ?? "anon";
      const { success } = await ratelimit.limit(`cortar:${ip}`);
      if (!success) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    }

    const { nombre, footageUrl, umbralDb, duracionMinima, margenSeg } =
      await req.json();

    if (!nombre || !footageUrl) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: nombre, footageUrl" },
        { status: 400 }
      );
    }

    const corte = await createCorte({
      nombre,
      footageUrl,
      umbralDb,
      duracionMinima,
      margenSeg,
    });

    await inngest.send({
      name: "cortar/run",
      data: { corteId: corte.id },
    });

    return NextResponse.json(
      { corteId: corte.id, status: "queued" },
      { status: 202 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cortar/route]", msg);
    return NextResponse.json(
      { error: "Error interno", detail: msg },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;
    const cortes = await getAllCortes();
    return NextResponse.json({ cortes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
