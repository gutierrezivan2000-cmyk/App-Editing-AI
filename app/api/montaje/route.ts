import { NextResponse } from "next/server";
import { createMontaje, getAllMontajes } from "@/lib/montajes-db";
import { inngest } from "@/inngest/client";
import { ratelimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  try {
    if (ratelimit) {
      const ip = req.headers.get("x-forwarded-for") ?? "anon";
      const { success } = await ratelimit.limit(`montaje:${ip}`);
      if (!success) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    const { nombre, footageUrl, umbralDb, duracionMinima, margenSeg } = body;
    if (!nombre || !footageUrl) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: nombre, footageUrl" },
        { status: 400 }
      );
    }

    const montaje = await createMontaje({
      nombre,
      footageUrl,
      umbralDb,
      duracionMinima,
      margenSeg,
    });

    await inngest.send({
      name: "montaje/run",
      data: { montajeId: montaje.id },
    });

    return NextResponse.json(
      { montajeId: montaje.id, status: "queued" },
      { status: 202 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[montaje/route]", msg);
    return NextResponse.json(
      { error: "Error interno", detail: msg },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const montajes = await getAllMontajes();
    return NextResponse.json({ montajes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
