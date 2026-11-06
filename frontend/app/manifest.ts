import type { MetadataRoute } from "next";

// Manifest de la app (servido en /manifest.webmanifest y enlazado
// automáticamente por Next). Iconos: isotipo E360 en public/icons/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EFAAT360",
    short_name: "EFAAT360",
    description: "Gestiona tus sorteos en grupos de WhatsApp: reservas, pagos, mensajes automáticos y sesiones.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "es",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
