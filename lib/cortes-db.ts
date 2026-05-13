import { sql } from "@vercel/postgres";

export interface Corte {
  id: string;
  nombre: string;
  footageUrl: string;
  xmlUrl?: string;
  edlUrl?: string;
  status: "pending" | "processing" | "completed" | "error";
  errorMessage?: string;
  umbralDb: number;
  duracionMinima: number;
  margenSeg: number;
  silenciosCount: number;
  segmentsCount: number;
  duracionSeg: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateCorteInput {
  nombre: string;
  footageUrl: string;
  umbralDb?: number;
  duracionMinima?: number;
  margenSeg?: number;
}

interface UpdateCorteInput {
  status?: Corte["status"];
  xmlUrl?: string;
  edlUrl?: string;
  errorMessage?: string;
  silenciosCount?: number;
  segmentsCount?: number;
  duracionSeg?: number;
}

function rowToCorte(row: Record<string, unknown>): Corte {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    footageUrl: row.footage_url as string,
    xmlUrl: (row.xml_url as string | null) ?? undefined,
    edlUrl: (row.edl_url as string | null) ?? undefined,
    status: row.status as Corte["status"],
    errorMessage: (row.error_message as string | null) ?? undefined,
    umbralDb: Number(row.umbral_db),
    duracionMinima: Number(row.duracion_minima),
    margenSeg: Number(row.margen_seg),
    silenciosCount: Number(row.silencios_count ?? 0),
    segmentsCount: Number(row.segments_count ?? 0),
    duracionSeg: Number(row.duracion_seg ?? 0),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function createCorte(input: CreateCorteInput): Promise<Corte> {
  const { rows } = await sql`
    INSERT INTO cortes (nombre, footage_url, umbral_db, duracion_minima, margen_seg)
    VALUES (
      ${input.nombre},
      ${input.footageUrl},
      ${input.umbralDb ?? -30},
      ${input.duracionMinima ?? 0.5},
      ${input.margenSeg ?? 0.05}
    )
    RETURNING *
  `;
  return rowToCorte(rows[0]);
}

export async function getCorte(id: string): Promise<Corte> {
  const { rows } = await sql`SELECT * FROM cortes WHERE id = ${id}`;
  if (rows.length === 0) throw new Error(`Corte no encontrado: ${id}`);
  return rowToCorte(rows[0]);
}

export async function updateCorte(
  id: string,
  patch: UpdateCorteInput
): Promise<Corte> {
  const { rows } = await sql`
    UPDATE cortes
    SET
      status          = COALESCE(${patch.status ?? null}, status),
      xml_url         = COALESCE(${patch.xmlUrl ?? null}, xml_url),
      edl_url         = COALESCE(${patch.edlUrl ?? null}, edl_url),
      error_message   = COALESCE(${patch.errorMessage ?? null}, error_message),
      silencios_count = COALESCE(${patch.silenciosCount ?? null}, silencios_count),
      segments_count  = COALESCE(${patch.segmentsCount ?? null}, segments_count),
      duracion_seg    = COALESCE(${patch.duracionSeg ?? null}, duracion_seg),
      updated_at      = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) throw new Error(`Corte no encontrado: ${id}`);
  return rowToCorte(rows[0]);
}

export async function getAllCortes(): Promise<Corte[]> {
  const { rows } = await sql`SELECT * FROM cortes ORDER BY created_at DESC LIMIT 50`;
  return rows.map(rowToCorte);
}
