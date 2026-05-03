"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
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
    <div className="space-y-6 p-4 sm:p-6">
      <Header title="Nuevo cliente" />
      <Card className="max-w-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900">Perfil del cliente</h2>
        </CardHeader>
        <CardContent>
          <ClienteForm onSave={handleSave} />
        </CardContent>
      </Card>
    </div>
  );
}
