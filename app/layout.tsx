import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist (Sans + Mono) — la tipografia moderna por defecto de Vercel/Next.js.
// Antes usabamos Inter; Geist tiene mejor numerica tabular para la dashboard
// (KPIs, timestamps, tablas) y un caracter mas neutro/profesional.
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VideoIA Agency",
  description: "Sistema autónomo de edición de video con IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="h-full bg-gray-50 font-sans antialiased text-gray-900">
        {children}
      </body>
    </html>
  );
}
