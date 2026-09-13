"use client";

import { use } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import ConfiguracionGrupo from "@/components/automatizacion/ConfiguracionGrupo/ConfiguracionGrupo";
import { normalizarGrupoId } from "@/services/automatizacion/mergeGrupos";

export default function Page({
  params,
}: {
  params: Promise<{ grupoId: string }>;
}) {

  const { grupoId } = use(params);

  // Único punto de entrada del JID de grupo desde la URL — se decodifica
  // AQUÍ, antes de que cualquier otra cosa lo use (comparar contra grupos
  // reales, guardar en Supabase). Reutiliza normalizarGrupoId(), ya
  // probado en services/automatizacion/mergeGrupos.ts: NUNCA se reinventa
  // este criterio en un segundo lugar. Sin esto, "@" llega percent-encoded
  // ("%40") desde la URL y termina guardado tal cual en Supabase (bug real
  // encontrado en auditoría — ver supabase_migrations/012_...).
  const grupoIdReal = normalizarGrupoId(grupoId);

  return (
    <DashboardLayout>
      {/* key fuerza un remount completo al cambiar de grupo — cada
          sección de configuración parte de un useState(inicial) simple,
          sin efecto de resincronización, así que necesita una montura
          fresca por grupo (nunca reutilizar el árbol de un grupo previo). */}
      <ConfiguracionGrupo key={grupoIdReal} grupoId={grupoIdReal} />
    </DashboardLayout>
  );

}
