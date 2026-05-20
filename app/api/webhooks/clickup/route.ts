import { NextResponse } from "next/server";
import { getProjectByClickupTask } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { verifyClickupSignature } from "@/lib/hmac";

export async function POST(req: Request) {
  try {
    // CLICKUP_WEBHOOK_SECRET es OBLIGATORIO. Antes con `!` se asumía que
    // existía; si la env var estaba ausente o vacía, `verifyClickupSignature`
    // calculaba HMAC con `""` y aceptaba cualquier payload firmado contra
    // string vacío → webhook efectivamente público.
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    if (!secret || secret.length < 8) {
      console.error("[clickup webhook] CLICKUP_WEBHOOK_SECRET no configurado");
      return NextResponse.json(
        { error: "Webhook no configurado" },
        { status: 503 }
      );
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-signature");

    if (!verifyClickupSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as {
      event: string;
      task_id: string;
      history_items?: Array<{ after?: { status?: string } }>;
    };
    const { event, task_id, history_items } = body;

    const newStatus = history_items?.[0]?.after?.status;
    if (event === "taskStatusUpdated" && newStatus === "en edicion") {
      const project = await getProjectByClickupTask(task_id);
      if (project) {
        await inngest.send({
          name: "pipeline/run",
          data: { projectId: project.id },
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[clickup webhook]", error);
    return NextResponse.json(
      { error: "Error procesando webhook" },
      { status: 500 }
    );
  }
}
