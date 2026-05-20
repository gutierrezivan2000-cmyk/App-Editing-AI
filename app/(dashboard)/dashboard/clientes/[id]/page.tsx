"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import type { ClienteProfile } from "@/types";

export default function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [cliente, setCliente] = useState<ClienteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setCliente(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleSave = async (profile: ClienteProfile) => {
    const res = await fetch(`/api/clientes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Error al guardar");
    }
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.refresh();
    }, 2000);
  };

  return (
    <div className="flex flex-col">
      <Header
        title={cliente?.nombre ?? id}
        description={
          cliente
            ? `Editando perfil del cliente ${id}`
            : `Cargando perfil…`
        }
        actions={
          <Link
            href="/dashboard/clientes"
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← Todos los clientes
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          {saved && (
            <div className="mb-4 rounded-md bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 flex items-center gap-2">
              <CheckIcon className="h-4 w-4" />
              Cambios guardados
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
            {loading ? (
              <ClienteFormSkeleton />
            ) : (
              <ClienteForm initial={cliente ?? undefined} onSave={handleSave} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Placeholder shimmer mientras carga el cliente. Mas amigable que un
 * "Cargando..." plano y mantiene el alto del card estable.
 */
function ClienteFormSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-9 rounded bg-gray-100" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-gray-200" />
        <div className="h-9 rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="h-3 w-16 rounded bg-gray-200" />
          <div className="h-9 rounded bg-gray-100" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-gray-200" />
          <div className="h-9 rounded bg-gray-100" />
        </div>
      </div>
      <div className="h-32 rounded bg-gray-100" />
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
