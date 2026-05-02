import { NextResponse } from "next/server";
import { getClienteProfile } from "@/lib/clientes";
import { upsertCliente } from "@/lib/db";
import type { ClienteProfile } from "@/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = await getClienteProfile(id);
    return NextResponse.json(profile);
  } catch (error) {
    console.error("[clientes/[id] GET]", error);
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as ClienteProfile;

    if (!body.id || !body.nombre) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    body.id = id;
    await upsertCliente(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[clientes/[id] PUT]", error);
    return NextResponse.json(
      { error: "Error al guardar el cliente" },
      { status: 500 }
    );
  }
}
