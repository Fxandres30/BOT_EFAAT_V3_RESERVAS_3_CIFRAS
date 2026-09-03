"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { getSessions } from "@/services/sessions/getSessions";

export default function useSessions(
    usuarioId: string
) {

    const [sessions, setSessions] =
        useState<any[]>([]);

    async function load() {

        if (!usuarioId)
            return;

        const { data, error } =
            await getSessions(usuarioId);

        if (error) {

            console.error(error);

            return;

        }

        setSessions(data || []);

    }

    useEffect(() => {

        if (!usuarioId)
            return;

        load();

        const channel = supabase

            .channel(`sesiones-${usuarioId}`)

            .on(

                "postgres_changes",

                {

                    event: "*",

                    schema: "public",

                    table: "sesiones",

                    filter: `usuario_id=eq.${usuarioId}`

                },

                () => {

                    load();

                }

            )

            .subscribe();

        return () => {

            channel.unsubscribe();

        };

    }, [usuarioId]);

    return {

        sessions,

        load

    };

}