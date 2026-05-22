import { sql } from "@vercel/postgres";

export type MontajeStatus = "pending" | "processing" | "completed" | "error";

export interface Montaje {
  id: string;
  nombre: string;
  footageUrl: string;
  videoFinalUrl?: string;
  status: MontajeStatus;
  step?: string;
  errorMessage?: string;
  umbralDb: number;
  duracionMinima: number;
  margenSeg: number;
  silenciosCount: number;
  segmentsCount: number;
  duracionOriginalSeg: number;
  duracionFinalSeg: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateMontajeInput {
  nombre: string;
  footageUrl: string;
  umbralDb?: number;
  duracionMinima?: number;
  margenSeg?: number;
}

interface UpdateMontajeInput {
  status?: MontajeStatus;
  step?: string;
  videoFinalUrl?: string;
  errorMessage?: string;
  silenciosCount?: number;
  segmentsCount?: number;
  duracionOriginalSeg?: number;
  duracionFinalSeg?: number;
}

function rowToMontaje(row: Record<string, unknown>): Montaje {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    footageUrl: row.footage_url as string,
    videoFinalUrl: (row.video_final_url as string | null) ?? undefined,
    status: row.status as MontajeStatus,
    step: (row.step as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    umbralDb: Number(row.umbral_db),
    duracionMinima: Number(row.duracion_minima),
    margenSeg: Number(row.margen_seg),
    silenciosCount: Number(row.silencios_count ?? 0),
    segmentsCount: Number(row.segments_count ?? 0),
    duracionOriginalSeg: Number(row.duracion_original_seg ?? 0),
    duracionFinalSeg: Number(row.duracion_final_seg ?? 0),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function createMontaje(input: CreateMontajeInput): Promise<Montaje> {
  const { rows } = await sql`
    INSERT INTO montajes (nombre, footage_url, umbral_db, duracion_minima, margen_seg)
    VALUES (
      ${input.nombre},
      ${input.footageUrl},
      ${input.umbralDb ?? -30},
      ${input.duracionMinima ?? 0.5},
      ${input.margenSeg ?? 0.05}
    )
    RETURNING *
  `;
  return rowToMontaje(rows[0]);
}

export async function getMontaje(id: string): Promise<Montaje> {
  const { rows } = await sql`SELECT * FROM montajes WHERE id = ${id}`;
  if (rows.length === 0) throw new Error(`Montaje no encontrado: ${id}`);
  return rowToMontaje(rows[0]);
}

export async function updateMontaje(
  id: string,
  patch: UpdateMontajeInput
): Promise<Montaje> {
  const { rows } = await sql`
    UPDATE montajes
    SET
      status                 = COALESCE(${patch.status ?? null}, status),
      step                   = COALESCE(${patch.step ?? null}, step),
      video_final_url        = COALESCE(${patch.videoFinalUrl ?? null}, video_final_url),
      error_message          = COALESCE(${patch.errorMessage ?? null}, error_message),
      silencios_count        = COALESCE(${patch.silenciosCount ?? null}, silencios_count),
      segments_count         = COALESCE(${patch.segmentsCount ?? null}, segments_count),
      duracion_original_seg  = COALESCE(${patch.duracionOriginalSeg ?? null}, duracion_original_seg),
      duracion_final_seg     = COALESCE(${patch.duracionFinalSeg ?? null}, duracion_final_seg),
      updated_at             = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) throw new Error(`Montaje no encontrado: ${id}`);
  return rowToMontaje(rows[0]);
}

export async function getAllMontajes(): Promise<Montaje[]> {
  const { rows } = await sql`SELECT * FROM montajes ORDER BY created_at DESC LIMIT 50`;
  return rows.map(rowToMontaje);
}
