import { sql } from "@vercel/postgres";
import { Proyecto, ClienteProfile } from "@/types";

interface CreateProjectInput {
  clienteId: string;
  nombre: string;
  brief: string;
  footageUrl: string;
  renderMethod?: "original" | "mirage" | "cortes";
  clickupTaskId?: string;
}

interface UpdateProjectInput {
  status?: Proyecto["status"];
  outputUrl?: string;
  errorMessage?: string;
  xmlUrl?: string;
  edlUrl?: string;
  capcutUrl?: string;
  cortesAnalysis?: unknown;
  keepSegmentsCount?: number;
  duracionSeg?: number;
}

function rowToProyecto(row: Record<string, unknown>): Proyecto {
  return {
    id: row.id as string,
    clienteId: row.cliente_id as string,
    nombre: row.nombre as string,
    brief: row.brief as string,
    footageUrl: row.footage_url as string,
    outputUrl: (row.output_url as string | null) ?? undefined,
    status: row.status as Proyecto["status"],
    renderMethod: (row.render_method as Proyecto["renderMethod"]) ?? "original",
    clickupTaskId: (row.clickup_task_id as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    xmlUrl: (row.xml_url as string | null) ?? undefined,
    edlUrl: (row.edl_url as string | null) ?? undefined,
    capcutUrl: (row.capcut_url as string | null) ?? undefined,
    cortesAnalysis: (row.cortes_analysis as unknown) ?? undefined,
    keepSegmentsCount:
      row.keep_segments_count !== undefined && row.keep_segments_count !== null
        ? Number(row.keep_segments_count)
        : undefined,
    duracionSeg:
      row.duracion_seg !== undefined && row.duracion_seg !== null
        ? Number(row.duracion_seg)
        : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function createProject(input: CreateProjectInput): Promise<Proyecto> {
  try {
    const { rows } = await sql`
      INSERT INTO proyectos (cliente_id, nombre, brief, footage_url, render_method, clickup_task_id)
      VALUES (
        ${input.clienteId},
        ${input.nombre},
        ${input.brief},
        ${input.footageUrl},
        ${input.renderMethod ?? "original"},
        ${input.clickupTaskId ?? null}
      )
      RETURNING *
    `;
    return rowToProyecto(rows[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Column render_method not yet migrated — fall back to legacy INSERT
    if (msg.includes("render_method") || msg.includes("column")) {
      const { rows } = await sql`
        INSERT INTO proyectos (cliente_id, nombre, brief, footage_url, clickup_task_id)
        VALUES (
          ${input.clienteId},
          ${input.nombre},
          ${input.brief},
          ${input.footageUrl},
          ${input.clickupTaskId ?? null}
        )
        RETURNING *
      `;
      return rowToProyecto(rows[0]);
    }
    throw err;
  }
}

export async function getProject(id: string): Promise<Proyecto> {
  const { rows } = await sql`
    SELECT * FROM proyectos WHERE id = ${id}
  `;
  if (rows.length === 0) throw new Error(`Proyecto no encontrado: ${id}`);
  return rowToProyecto(rows[0]);
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput
): Promise<Proyecto> {
  const cortesAnalysisJson =
    patch.cortesAnalysis !== undefined
      ? JSON.stringify(patch.cortesAnalysis)
      : null;
  const { rows } = await sql`
    UPDATE proyectos
    SET
      status              = COALESCE(${patch.status ?? null}, status),
      output_url          = COALESCE(${patch.outputUrl ?? null}, output_url),
      error_message       = COALESCE(${patch.errorMessage ?? null}, error_message),
      xml_url             = COALESCE(${patch.xmlUrl ?? null}, xml_url),
      edl_url             = COALESCE(${patch.edlUrl ?? null}, edl_url),
      capcut_url          = COALESCE(${patch.capcutUrl ?? null}, capcut_url),
      cortes_analysis     = COALESCE(${cortesAnalysisJson}::jsonb, cortes_analysis),
      keep_segments_count = COALESCE(${patch.keepSegmentsCount ?? null}, keep_segments_count),
      duracion_seg        = COALESCE(${patch.duracionSeg ?? null}, duracion_seg),
      updated_at          = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) throw new Error(`Proyecto no encontrado: ${id}`);
  return rowToProyecto(rows[0]);
}

export async function getProjectByClickupTask(
  taskId: string
): Promise<Proyecto | null> {
  const { rows } = await sql`
    SELECT * FROM proyectos WHERE clickup_task_id = ${taskId} LIMIT 1
  `;
  return rows.length > 0 ? rowToProyecto(rows[0]) : null;
}

export async function getAllProyectos(): Promise<Proyecto[]> {
  const { rows } = await sql`
    SELECT * FROM proyectos ORDER BY created_at DESC
  `;
  return rows.map(rowToProyecto);
}

export async function getProyectosByCliente(clienteId: string): Promise<Proyecto[]> {
  const { rows } = await sql`
    SELECT * FROM proyectos WHERE cliente_id = ${clienteId} ORDER BY created_at DESC
  `;
  return rows.map(rowToProyecto);
}

export async function getClienteFromDB(id: string): Promise<ClienteProfile | null> {
  const { rows } = await sql`
    SELECT * FROM clientes WHERE id = ${id}
  `;
  if (rows.length === 0) return null;
  return rows[0].perfil_json as ClienteProfile;
}

export async function getAllClientes(): Promise<ClienteProfile[]> {
  const { rows } = await sql`
    SELECT * FROM clientes ORDER BY created_at DESC
  `;
  return rows.map((r) => r.perfil_json as ClienteProfile);
}

export async function upsertCliente(profile: ClienteProfile): Promise<void> {
  await sql`
    INSERT INTO clientes (id, nombre, perfil_json)
    VALUES (${profile.id}, ${profile.nombre}, ${JSON.stringify(profile)})
    ON CONFLICT (id) DO UPDATE
    SET nombre = EXCLUDED.nombre, perfil_json = EXCLUDED.perfil_json
  `;
}

export async function getProyectosMetrics(): Promise<{
  total: number;
  completedToday: number;
  processing: number;
  errors: number;
}> {
  const { rows } = await sql`
    SELECT
      COUNT(*) FILTER (WHERE TRUE) AS total,
      COUNT(*) FILTER (
        WHERE status = 'completed'
        AND updated_at >= NOW() - INTERVAL '24 hours'
      ) AS completed_today,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing,
      COUNT(*) FILTER (WHERE status = 'error') AS errors
    FROM proyectos
  `;
  return {
    total: Number(rows[0].total),
    completedToday: Number(rows[0].completed_today),
    processing: Number(rows[0].processing),
    errors: Number(rows[0].errors),
  };
}
