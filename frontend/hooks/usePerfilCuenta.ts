"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { obtenerPerfil, type PerfilCuenta } from "@/lib/cuenta/cuenta";

// Perfil del usuario de la sesión actual (Supabase Auth). `recargar` vuelve a
// leerlo tras un cambio.
export default function usePerfilCuenta() {

    const [perfil, setPerfil] = useState<PerfilCuenta | null>(null);
    const [cargando, setCargando] = useState(true);

    const recargar = useCallback(async () => {
        setPerfil(await obtenerPerfil(supabase.auth));
    }, []);

    useEffect(() => {
        let vigente = true;
        obtenerPerfil(supabase.auth).then((p) => {
            if (!vigente) return;
            setPerfil(p);
            setCargando(false);
        });
        return () => { vigente = false; };
    }, []);

    return { perfil, cargando, recargar };

}
