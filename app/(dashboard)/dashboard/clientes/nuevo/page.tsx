"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import type { ClienteProfile } from "@/types";

export default function NuevoClientePage() {
  const router = useRouter();

  const handleSave = async (profile: ClienteProfile) => {
    const res = await fetch(`/api/clientes/${profile.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Error al guardar");
    }
    router.push("/dashboard/clientes");
  };

  return (
    <div className="flex flex-col">
      <Header
        title="Nuevo cliente"
        description="Configurá el brand-kit: tipografías, colores, animación de subtítulos y formato de exportación."
        actions={
          <Link
            href="/dashboard/clientes"
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← Cancelar
          </Link>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
          <ClienteForm onSave={handleSave} />
        </div>
      </div>
    </div>
  );
}
