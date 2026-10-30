import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import ReenvioRecuperacion from "@/components/auth/ReenvioRecuperacion";
import { ContenedorAvisos } from "@/components/ui/Avisos";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EFAAT — Panel",
  description: "Panel de EFAAT para gestionar tus sorteos en grupos de WhatsApp: reservas, pagos, mensajes automáticos y sesiones.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ReenvioRecuperacion />
        {children}
        <ContenedorAvisos />
      </body>
    </html>
  );
}
