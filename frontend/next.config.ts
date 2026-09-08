import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  // Distribución directa del APK de "EFAAT Payments Reader"
  // (frontend/public/downloads/EFAAT-Payments-Reader.apk) — servido
  // same-origin, sin redirecciones, en vez de apuntar a GitHub Releases
  // (esa URL pasa por un redirect 302 a un blob firmado de Azure que en
  // algunos Android/Chrome deja la descarga colgada en 100% sin
  // finalizar). Ver frontend/components/pagos/LectorPagosPage.
  //
  // "Headers are checked before the filesystem which includes pages and
  // /public files" (docs de esta versión de Next) — por eso esto SÍ
  // sobrescribe el Content-Type/Content-Disposition que Next pondría por
  // defecto para un archivo de /public.
  async headers() {
    return [
      {
        source: "/downloads/EFAAT-Payments-Reader.apk",
        headers: [
          {
            key: "Content-Type",
            value: "application/vnd.android.package-archive",
          },
          {
            key: "Content-Disposition",
            value: 'attachment; filename="EFAAT-Payments-Reader.apk"',
          },
          {
            key: "Cache-Control",
            value: "public, max-age=3600",
          },
        ],
      },
    ];
  },

};

export default nextConfig;
