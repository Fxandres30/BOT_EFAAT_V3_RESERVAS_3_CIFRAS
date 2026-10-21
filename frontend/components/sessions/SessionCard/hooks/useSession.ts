"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

import { connectSession, isSessionNotFound } from "@/services/sessions/connectSession";
import { disconnectSession } from "@/services/sessions/disconnectSession";
import { getSession } from "@/services/sessions/getSession";
import { crearControlAccion } from "@/services/sessions/controlAccionSesion";
import type { ResultadoAccion } from "@/services/sessions/accionSesion";

export function useSession(
    id: string,
    estadoInicial: string,
    onSessionNotFound?: () => void
) {

    const [loading, setLoading] = useState(false);

    // Mensaje del último fallo (o aviso si el bot no confirmó a tiempo);
    // se limpia al iniciar otra acción.
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);

    const [open, setOpen] = useState(false);

    const [qr, setQr] = useState("");

    const [segundos, setSegundos] = useState(120);

    const [estadoActual, setEstadoActual] =
        useState(estadoInicial);

    // «Procesando…» siempre termina: con error, con la confirmación del bot
    // (cambio de estado en Supabase) o al vencer la espera. Ver
    // services/sessions/controlAccionSesion.ts.
    const [control] = useState(() => crearControlAccion({
        alCambiar: ({ cargando, error: e, aviso: a }) => {
            setLoading(cargando);
            setError(e);
            setAviso(a);
        }
    }));

    useEffect(() => () => control.destruir(), [control]);

    useEffect(() => {

        setEstadoActual(estadoInicial);

    }, [estadoInicial]);

    // ============================================
    // CONTADOR
    // ============================================

    useEffect(() => {

        if (!open)
            return;

        const interval = setInterval(() => {

            setSegundos((actual) => {

                if (actual <= 1) {

                    clearInterval(interval);

                    setOpen(false);

                    return 0;

                }

                return actual - 1;

            });

        }, 1000);

        return () => clearInterval(interval);

    }, [open]);

    // Ejecuta conectar/desconectar una sola vez a la vez y entrega el
    // resultado al control (que decide cuándo deja de cargar).
    async function ejecutar(accion: () => Promise<ResultadoAccion>) {

        if (!control.iniciar()) return;

        const res = await accion();

        control.resultado(res);

        // La tarjeta desaparece al actualizar la lista: el aviso va aparte.
        if (isSessionNotFound(res)) {
            alert(res.ok ? "" : res.mensaje);
            onSessionNotFound?.();
        }

    }

    async function accionPrincipal() {

        if (control.enCurso())
            return;

        // ==========================
        // DESCONECTAR
        // ==========================
        if (estadoActual === "conectado") {

            await ejecutar(() => disconnectSession(id));

            return;

        }

        // ==========================
        // VER QR
        // ==========================
        if (estadoActual === "esperando_qr") {

            const { data } = await getSession(id);

            if (!data?.qr)
                return;
            setQr(data.qr);

            if (data.qr_expira_en) {

                const restante = Math.max(
                    Math.floor(
                        (new Date(data.qr_expira_en).getTime() - Date.now()) / 1000
                    ),
                    0
                );

                setSegundos(restante);

            } else {

                setSegundos(120);

            }

            setOpen(true);

            return;

        }

        // ==========================
        // CONECTAR
        // ==========================
        await ejecutar(() => connectSession(id));

    }

    // «Reconectar» del menú: misma acción y mismo control que «Conectar».
    async function reconectar() {

        await ejecutar(() => connectSession(id));

    }

    function textoBoton() {

        if (loading)
            return "Procesando...";

        if (estadoActual === "conectado")
            return "Desconectar";

        if (estadoActual === "esperando_qr")
            return "Ver QR";

        return "Conectar";

    }

    useEffect(() => {

        const canal = supabase

            .channel(`sesion-${id}`)

            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "sesiones",
                    filter: `id=eq.${id}`
                },
                (payload: { new: { estado: string; qr?: string; qr_expira_en?: string } }) => {

                    const sesion = payload.new;

                    setEstadoActual(sesion.estado);

                    if (
                        sesion.estado === "esperando_qr" &&
                        sesion.qr
                    ) {

                        setQr(sesion.qr);

                        if (sesion.qr_expira_en) {

                            const restante = Math.max(
                                Math.floor(
                                    (new Date(sesion.qr_expira_en).getTime() - Date.now()) / 1000
                                ),
                                0
                            );

                            setSegundos(restante);

                        }

                    }

                    if (
                        sesion.estado === "conectado" ||
                        sesion.estado === "desconectado"
                    ) {

                        setOpen(false);

                        setQr("");

                        setSegundos(120);

                    }

                    // El bot confirmó con un cambio real de estado.
                    control.confirmado();

                }

            )

            .subscribe();

        return () => {

            supabase.removeChannel(canal);

        };

    }, [id, control]);

    return {

        loading,

        error,

        aviso,

        open,

        qr,

        segundos,

        estadoActual,

        accionPrincipal,

        reconectar,

        textoBoton,

        cerrarQR: () => setOpen(false)

    };

}
