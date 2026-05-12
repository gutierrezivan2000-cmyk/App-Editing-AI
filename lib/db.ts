import { sql } from "@vercel/postgres";
import { Proyecto, ClienteProfile } from "@/types";

interface CreateProjectInput {
  clienteId: string;
  nombre: string;
  brief: string;
  footageUrl: string;
  renderMethod?: "original" | "mirage";
  clickupTaskId?: string;
}

interface UpdateProjectInput {
  status?: Proyecto["status"];
  outputUrl?: string;
  errorMessage?: string;
}

function rowToProyecto(row: Record<string, unknown>): Proyecto {
  return {
    id: row.id as string,
    clienteId: row.cliente_id as string,
    nombre: row.nombre as string,
    brief: row.brief as string,
    footageUrl: row.footage_url as string,
    outputUrl: row.output_url as string | undefined,
    status: row.status as Proyecto["status"],
    renderMethod: (row.render_method as Proyecto["renderMethod"]) ?? "original",
    clickupTaskId: row.clickup_task_id as string | undefined,
    errorMessage: row.error_message as string | undefined,
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
  const { rows } = await sql`
    UPDATE proyectos
    SET
      status        = COALESCE(${patch.status ?? null}, status),
      output_url    = COALESCE(${patch.outputUrl ?? null}, output_url),
      error_message = COALESCE(${patch.errorMessage ?? null}, error_message),
      updated_at    = NOW()
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
