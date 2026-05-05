const MIRAGE_BASE = "https://api.captions.ai";

interface MirageJob {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress?: number;
  error?: string;
  output_url?: string;
}

interface MirageTemplate {
  id: string;
  name: string;
  preview_url?: string;
}

function headers(): Record<string, string> {
  return {
    "x-api-key": process.env.MIRAGE_API_KEY ?? "",
    Accept: "application/json",
  };
}

export async function listarTemplates(): Promise<MirageTemplate[]> {
  const res = await fetch(`${MIRAGE_BASE}/api/caption-templates`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Mirage templates ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.templates ?? data) as MirageTemplate[];
}

export async function enviarVideo(
  videoUrl: string,
  captionTemplateId: string
): Promise<string> {
  const res = await fetch(`${MIRAGE_BASE}/api/video-captions`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ video_url: videoUrl, caption_template_id: captionTemplateId }),
  });
  if (!res.ok) {
    throw new Error(`Mirage submit ${res.status}: ${await res.text()}`);
  }
  const job = (await res.json()) as MirageJob;
  return job.id;
}

export async function consultarEstado(jobId: string): Promise<MirageJob> {
  const res = await fetch(`${MIRAGE_BASE}/api/video-captions/${jobId}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Mirage poll ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<MirageJob>;
}

export async function esperarCompletado(
  jobId: string,
  maxWaitMs = 600_000
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  let delay = 5_000;
  while (Date.now() < deadline) {
    const job = await consultarEstado(jobId);
    if (job.status === "COMPLETED") {
      if (!job.output_url) throw new Error("Mirage completó sin output_url");
      return job.output_url;
    }
    if (job.status === "FAILED") {
      throw new Error(`Mirage falló: ${job.error ?? "error desconocido"}`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 30_000);
  }
  throw new Error(`Mirage job ${jobId} timeout tras ${maxWaitMs / 1000}s`);
}

export async function renderizarConMirage(
  videoUrl: string
): Promise<{ url: string }> {
  const apiKey = process.env.MIRAGE_API_KEY;
  const templateId = process.env.MIRAGE_CAPTION_TEMPLATE_ID;
  if (!apiKey) throw new Error("MIRAGE_API_KEY no configurado");
  if (!templateId) throw new Error("MIRAGE_CAPTION_TEMPLATE_ID no configurado");

  const jobId = await enviarVideo(videoUrl, templateId);
  const url = await esperarCompletado(jobId);
  return { url };
}

export function mirageEnabled(): boolean {
  return Boolean(process.env.MIRAGE_API_KEY && process.env.MIRAGE_CAPTION_TEMPLATE_ID);
}
