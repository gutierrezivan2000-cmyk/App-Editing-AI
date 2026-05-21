import { sql } from "@vercel/postgres";
import { Proyecto, ClienteProfile } from "@/types";

interface CreateProjectInput {
  clienteId: string;
  nombre: string;
  brief: string;
  footageUrl: string;
  renderMethod?: "original" | "mirage" | "cortes" | "multiclip";
  clickupTaskId?: string;
  clips?: Proyecto["clips"];
  guion?: string;
  subtitulosOverride?: Proyecto["subtitulosOverride"];
  renderSubtitulos?: boolean;
  incluirClipsEnZip?: boolean;
  /**
   * ID del usuario dueño del proyecto. Requerido en runtime — las route
   * handlers lo extraen de `requireAuth()`. Lo dejo opcional en el tipo
   * para no romper callers de Inngest que ya tienen el proyecto cargado.
   */
  userId?: string;
}

interface UpdateProjectInput {
  status?: Proyecto["status"];
  outputUrl?: string;
  // null fuerza a borrar el error_message en DB (util para retry: limpia
  // el error del intento anterior). undefined -> mantiene el valor previo.
  errorMessage?: string | null;
  xmlUrl?: string;
  edlUrl?: string;
  capcutUrl?: string;
  srtUrl?: string;
  cortesAnalysis?: unknown;
  keepSegmentsCount?: number;
  duracionSeg?: number;
  clips?: Proyecto["clips"];
  planMulticlip?: Proyecto["planMulticlip"];
  subtitulosOverride?: Proyecto["subtitulosOverride"];
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
    srtUrl: (row.srt_url as string | null) ?? undefined,
    cortesAnalysis: (row.cortes_analysis as unknown) ?? undefined,
    keepSegmentsCount:
      row.keep_segments_count !== undefined && row.keep_segments_count !== null
        ? Number(row.keep_segments_count)
        : undefined,
    duracionSeg:
      row.duracion_seg !== undefined && row.duracion_seg !== null
        ? Number(row.duracion_seg)
        : undefined,
    clips: (row.clips as Proyecto["clips"]) ?? undefined,
    guion: (row.guion as string | null) ?? undefined,
    subtitulosOverride:
      (row.subtitulos_override as Proyecto["subtitulosOverride"]) ?? undefined,
    planMulticlip: (row.plan_multiclip as Proyecto["planMulticlip"]) ?? undefined,
    renderSubtitulos: (row.render_subtitulos as boolean | null) ?? false,
    incluirClipsEnZip: (row.incluir_clips_en_zip as boolean | null) ?? false,
    progress: (row.progress as Proyecto["progress"]) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function createProject(input: CreateProjectInput): Promise<Proyecto> {
  const clipsJson = input.clips ? JSON.stringify(input.clips) : null;
  const subsJson = input.subtitulosOverride
    ? JSON.stringify(input.subtitulosOverride)
    : null;
  const { rows } = await sql`
    INSERT INTO proyectos (
      cliente_id, nombre, brief, footage_url, render_method, clickup_task_id,
      clips, guion, subtitulos_override, user_id, render_subtitulos,
      incluir_clips_en_zip
    )
    VALUES (
      ${input.clienteId},
      ${input.nombre},
      ${input.brief},
      ${input.footageUrl},
      ${input.renderMethod ?? "original"},
      ${input.clickupTaskId ?? null},
      ${clipsJson}::jsonb,
      ${input.guion ?? null},
      ${subsJson}::jsonb,
      ${input.userId ?? null},
      ${input.renderSubtitulos ?? false},
      ${input.incluirClipsEnZip ?? false}
    )
    RETURNING *
  `;
  return rowToProyecto(rows[0]);
}

/**
 * Recupera un proyecto por id. Si `userId` se pasa, ENFORZA que el proyecto
 * pertenezca a ese usuario (o sea pre-migración con `user_id IS NULL`).
 *
 * Inngest jobs y código interno llaman sin userId — ya conocen el id y no
 * tiene sentido restringir. La autorización se hace una sola vez al inicio
 * de cada request HTTP, no en cada step de un job.
 */
export async function getProject(id: string, userId?: string): Promise<Proyecto> {
  if (userId) {
    const { rows } = await sql`
      SELECT * FROM proyectos
      WHERE id = ${id} AND (user_id = ${userId} OR user_id IS NULL)
    `;
    if (rows.length === 0) throw new Error(`Proyecto no encontrado: ${id}`);
    return rowToProyecto(rows[0]);
  }
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
  const clipsJson = patch.clips !== undefined ? JSON.stringify(patch.clips) : null;
  const planJson =
    patch.planMulticlip !== undefined ? JSON.stringify(patch.planMulticlip) : null;
  const subsJson =
    patch.subtitulosOverride !== undefined
      ? JSON.stringify(patch.subtitulosOverride)
      : null;
  // errorMessage: si el caller pasa `null` explicitamente, fuerza un
  // SET error_message = NULL (limpia el error). Si pasa undefined, mantiene
  // el valor previo via COALESCE. Si pasa un string, lo escribe.
  // Necesario para que el endpoint retry pueda borrar el error.
  const clearError = patch.errorMessage === null;
  const errorValue =
    patch.errorMessage === null
      ? null
      : (patch.errorMessage ?? null);
  // CANCELACION: si el proyecto fue cancelado (error_message =
  // "Cancelado por el usuario"), NO permitimos que Inngest lo sobrescriba
  // al final del pipeline con status='completed'. Sin esta proteccion,
  // un proyecto cancelado a mitad terminaria como "completed" cuando el
  // step largo (render) finalmente termine.
  //
  // La condicion solo se aplica cuando el caller intenta pasar a
  // 'completed'. Otras transiciones (a 'error', 'processing') siguen
  // funcionando — para permitir, por ejemplo, un retry posterior que
  // resetea a 'pending'.
  const protectFromOverwrite = patch.status === "completed";
  const { rows } = await sql`
    UPDATE proyectos
    SET
      status              = CASE
                              WHEN ${protectFromOverwrite}::boolean
                                AND error_message LIKE 'Cancelado%'
                              THEN status
                              ELSE COALESCE(${patch.status ?? null}, status)
                            END,
      output_url          = COALESCE(${patch.outputUrl ?? null}, output_url),
      error_message       = CASE
                              WHEN ${clearError}::boolean THEN NULL
                              ELSE COALESCE(${errorValue}, error_message)
                            END,
      xml_url             = COALESCE(${patch.xmlUrl ?? null}, xml_url),
      edl_url             = COALESCE(${patch.edlUrl ?? null}, edl_url),
      capcut_url          = COALESCE(${patch.capcutUrl ?? null}, capcut_url),
      srt_url             = COALESCE(${patch.srtUrl ?? null}, srt_url),
      cortes_analysis     = COALESCE(${cortesAnalysisJson}::jsonb, cortes_analysis),
      keep_segments_count = COALESCE(${patch.keepSegmentsCount ?? null}, keep_segments_count),
      duracion_seg        = COALESCE(${patch.duracionSeg ?? null}, duracion_seg),
      clips               = COALESCE(${clipsJson}::jsonb, clips),
      plan_multiclip      = COALESCE(${planJson}::jsonb, plan_multiclip),
      subtitulos_override = COALESCE(${subsJson}::jsonb, subtitulos_override),
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

export async function getAllProyectos(userId?: string): Promise<Proyecto[]> {
  if (userId) {
    const { rows } = await sql`
      SELECT * FROM proyectos
      WHERE user_id = ${userId} OR user_id IS NULL
      ORDER BY created_at DESC
    `;
    return rows.map(rowToProyecto);
  }
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

export async function getProyectosMetrics(userId?: string): Promise<{
  total: number;
  completedToday: number;
  processing: number;
  errors: number;
}> {
  if (userId) {
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
      WHERE user_id = ${userId} OR user_id IS NULL
    `;
    return {
      total: Number(rows[0].total),
      completedToday: Number(rows[0].completed_today),
      processing: Number(rows[0].processing),
      errors: Number(rows[0].errors),
    };
  }
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
