"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

interface HeaderProps {
  title: string;
}

export const Header = ({ title }: HeaderProps) => (
  <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
    <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      Cerrar sesión
    </Button>
  </header>
);
