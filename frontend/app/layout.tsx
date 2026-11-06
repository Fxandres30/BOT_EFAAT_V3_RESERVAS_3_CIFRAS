import type { Metadata, Viewport } from "next";
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
  applicationName: "EFAAT360",
  appleWebApp: { title: "EFAAT360" },
  // Isotipo E360: SOLO favicon e icono de aplicación. El logo principal
  // (máquina + EFAAT360) del panel y la landing no se toca.
  // Única declaración de iconos del proyecto; no hay favicon/icon en app/.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
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
