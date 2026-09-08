"use client";

import { use } from "react";

import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import ConfiguracionGrupo from "@/components/automatizacion/ConfiguracionGrupo/ConfiguracionGrupo";

export default function Page({
  params,
}: {
  params: Promise<{ grupoId: string }>;
}) {

  const { grupoId } = use(params);

  return (
    <DashboardLayout>
      <ConfiguracionGrupo grupoId={grupoId} />
    </DashboardLayout>
  );

}
