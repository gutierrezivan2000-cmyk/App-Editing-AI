"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

interface HeaderProps {
  title: string;
}

export const Header = ({ title }: HeaderProps) => (
  <header className="flex h-14 lg:h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
    {/* Title hidden on mobile — shown in mobile top bar as app name already */}
    <h1 className="text-base lg:text-lg font-semibold text-gray-900 truncate">{title}</h1>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      <span className="hidden sm:inline">Cerrar sesión</span>
      <span className="sm:hidden">Salir</span>
    </Button>
  </header>
);
