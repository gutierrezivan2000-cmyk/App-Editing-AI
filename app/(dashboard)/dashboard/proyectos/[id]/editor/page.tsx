import { notFound } from "next/navigation";
import { EditorClient } from "@/components/proyectos/editor/EditorClient";
import { getProject } from "@/lib/db";
import { getClienteProfile } from "@/lib/clientes";
import { downloadFromBlob } from "@/lib/blob";
import { auth } from "@/auth";
import type { WordTimestamp } from "@/types";

export const dynamic = "force-dynamic";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  let proyecto;
  try {
    proyecto = await getProject(id, session?.user?.id);
  } catch {
    notFound();
  }

  if (proyecto.renderMethod !== "multiclip") {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">
          El editor solo soporta proyectos multiclip por ahora.
        </p>
      </div>
    );
  }
  if (proyecto.status !== "completed") {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">
          El proyecto debe estar completado para editar. Estado actual:{" "}
          {proyecto.status}.
        </p>
      </div>
    );
  }

  const cliente = await getClienteProfile(proyecto.clienteId);

  // Cargar transcripcion ajustada al timeline final.
  const transcripcionUrl = `https://6bxtwiuhddelayzi.public.blob.vercel-storage.com/transcripciones-multiclip-final/${id}.json`;
  let transcripcion: WordTimestamp[] = [];
  try {
    const buf = await downloadFromBlob(transcripcionUrl);
    transcripcion = JSON.parse(buf.toString()) as WordTimestamp[];
  } catch {
    // Si falla, el editor arranca con transcripcion vacia — el usuario
    // puede armarla manualmente.
  }

  return (
    <EditorClient
      project={{
        id: proyecto.id,
        nombre: proyecto.nombre,
        clienteId: proyecto.clienteId,
        outputUrl: proyecto.outputUrl ?? "",
        clips: proyecto.clips ?? [],
        planMulticlip: proyecto.planMulticlip ?? {
          snippets: [],
          enfasisPalabras: [],
          animacionOverride: null,
          observaciones: "",
        },
        subtitulosOverride: proyecto.subtitulosOverride ?? null,
        renderSubtitulos: proyecto.renderSubtitulos ?? false,
      }}
      cliente={cliente}
      transcripcionInicial={transcripcion}
    />
  );
}
