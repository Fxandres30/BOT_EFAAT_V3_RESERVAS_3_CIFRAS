"use client";

import { useEffect, useState } from "react";
import { Plus, Smartphone } from "lucide-react";

import { getUser } from "@/services/auth/getUser";
import { createSession } from "@/services/sessions/createSession";
import useSessions from "@/hooks/useSessions";

import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

import SessionCard from "../SessionCard/SessionCard";

import styles from "./SessionsPage.module.css";

export default function SessionsPage() {
  const [usuarioId, setUsuarioId] = useState("");

  useEffect(() => {
    async function cargarUsuario() {
      const { data } = await getUser();

      if (data.user) {
        setUsuarioId(data.user.id);
      }
    }

    cargarUsuario();
  }, []);

  const { sessions, load } = useSessions(usuarioId);

  async function agregarSesion() {
    if (!usuarioId) {
      alert("Usuario no encontrado");
      return;
    }

    const res = await createSession(usuarioId);

    console.log(res);

    load();
  }

  return (
    <>
      <PageHeader
        title="Sesiones"
        description="Administra las sesiones de WhatsApp del bot."
        actions={
          <Button leftIcon={<Plus size={15} />} onClick={agregarSesion}>
            Agregar sesión
          </Button>
        }
      />

      {!usuarioId ? (
        <div className={styles.grid}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={196} radius={10} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Smartphone size={20} />}
          title="Todavía no hay sesiones"
          description="Crea una sesión para vincular un número de WhatsApp al bot."
          action={
            <Button leftIcon={<Plus size={15} />} onClick={agregarSesion}>
              Agregar sesión
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              id={session.id}
              nombre={session.nombre}
              telefono={session.telefono || "Sin conectar"}
              estado={session.estado}
              principal={session.principal}
              activa={session.activa}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </>
  );
}
