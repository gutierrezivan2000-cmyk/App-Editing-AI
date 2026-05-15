import { NextResponse } from "next/server";
import { createProject } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { ratelimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  try {
    if (ratelimit) {
      const ip = req.headers.get("x-forwarded-for") ?? "anon";
      const { success } = await ratelimit.limit(`pipeline:${ip}`);
      if (!success) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    }

    const { clienteId, footageUrl, brief, nombre, clickupTaskId, renderMethod } =
      await req.json();

    if (!clienteId || !footageUrl || !brief || !nombre) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    const method: "original" | "mirage" | "cortes" =
      renderMethod === "mirage"
        ? "mirage"
        : renderMethod === "cortes"
        ? "cortes"
        : "original";

    const project = await createProject({
      clienteId,
      footageUrl,
      brief,
      nombre,
      clickupTaskId,
      renderMethod: method,
    });

    if (method === "cortes") {
      await inngest.send({
        name: "pipeline/cortes-run",
        data: { projectId: project.id },
      });
    } else {
      await inngest.send({
        name: "pipeline/run",
        data: { projectId: project.id, renderMethod: method },
      });
    }

    return NextResponse.json(
      { projectId: project.id, status: "queued" },
      { status: 202 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[pipeline/route]", msg);
    return NextResponse.json(
      { error: "Error interno del servidor", detail: msg },
      { status: 500 }
    );
  }
}
