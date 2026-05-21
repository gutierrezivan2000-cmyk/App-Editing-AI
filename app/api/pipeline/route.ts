import { NextResponse } from "next/server";
import { createProject } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { ratelimit } from "@/lib/ratelimit";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    if (session instanceof NextResponse) return session;

    if (ratelimit) {
      const ip = req.headers.get("x-forwarded-for") ?? "anon";
      const { success } = await ratelimit.limit(`pipeline:${ip}`);
      if (!success) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    }

    const {
      clienteId,
      footageUrl,
      brief,
      nombre,
      clickupTaskId,
      renderMethod,
      clips,
      guion,
      subtitulosOverride,
      renderSubtitulos,
      incluirClipsEnZip,
    } = await req.json();

    if (!clienteId || !footageUrl || !brief || !nombre) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    const method: "original" | "mirage" | "cortes" | "multiclip" =
      renderMethod === "mirage"
        ? "mirage"
        : renderMethod === "cortes"
        ? "cortes"
        : renderMethod === "multiclip"
        ? "multiclip"
        : "original";

    if (method === "multiclip") {
      if (!Array.isArray(clips) || clips.length === 0) {
        return NextResponse.json(
          { error: "El modo multiclip requiere al menos un clip" },
          { status: 400 }
        );
      }
      if (clips.length > 20) {
        return NextResponse.json(
          { error: "Máximo 20 clips por proyecto" },
          { status: 400 }
        );
      }
    }

    const project = await createProject({
      clienteId,
      footageUrl,
      brief,
      nombre,
      clickupTaskId,
      renderMethod: method,
      clips: method === "multiclip" ? clips : undefined,
      guion: method === "multiclip" ? guion : undefined,
      subtitulosOverride,
      renderSubtitulos:
        method === "multiclip" ? Boolean(renderSubtitulos) : undefined,
      incluirClipsEnZip:
        method === "multiclip" ? Boolean(incluirClipsEnZip) : undefined,
      userId: session.user.id,
    });

    if (method === "cortes") {
      await inngest.send({
        name: "pipeline/cortes-run",
        data: { projectId: project.id },
      });
    } else if (method === "multiclip") {
      await inngest.send({
        name: "pipeline/multiclip-run",
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
