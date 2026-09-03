"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

import { connectSession } from "@/services/sessions/connectSession";
import { disconnectSession } from "@/services/sessions/disconnectSession";
import { getSession } from "@/services/sessions/getSession";

export function useSession(
    id: string,
    estadoInicial: string
) {

    const [loading, setLoading] = useState(false);

    const [open, setOpen] = useState(false);

    const [qr, setQr] = useState("");

    const [segundos, setSegundos] = useState(120);

    const [estadoActual, setEstadoActual] =
        useState(estadoInicial);

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

    async function accionPrincipal() {

        if (loading)
            return;

        // ==========================
        // DESCONECTAR
        // ==========================
        if (estadoActual === "conectado") {

            setLoading(true);

            await disconnectSession(id);

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
        setLoading(true);

        await connectSession(id);

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
                (payload: any) => {

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
                        sesion.estado === "conectado"
                    ) {

                        setOpen(false);

                        setQr("");

                        setSegundos(120);

                    }

                    if (
                        sesion.estado === "desconectado"
                    ) {

                        setOpen(false);

                        setQr("");

                        setSegundos(120);

                    }

                    setLoading(false);

                }

            )

            .subscribe();

        return () => {

            supabase.removeChannel(canal);

        };

    }, [id]);

    return {

        loading,

        open,

        qr,

        segundos,

        estadoActual,

        accionPrincipal,

        textoBoton,

        cerrarQR: () => setOpen(false)

    };

}