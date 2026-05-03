"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/dashboard/Header";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
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
    <div className="space-y-6 p-4 sm:p-6">
      <Header title={`Cliente: ${id}`} />
      <Card className="max-w-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900">Configuración del cliente</h2>
          {saved && (
            <p className="text-sm text-green-600 font-medium">✓ Guardado correctamente</p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400">Cargando...</p>
          ) : (
            <ClienteForm initial={cliente ?? undefined} onSave={handleSave} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
