"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { apiRifas } from "@/services/rifas/apiRifas";

// Con el motor de rifas independientes activo (MOTOR_RIFAS=nuevo), las
// pantallas antiguas por precio (/tablas, /tablas/:precio) llevan a «Mis
// rifas»: allí cada rifa es independiente y su reinicio solo la afecta a
// ella. Con el motor legado no hace nada.
export default function RedireccionMotorRifas() {
    const router = useRouter();
    useEffect(() => {
        let vivo = true;
        apiRifas.modo().then(r => { if (vivo && r.ok && r.modo === "nuevo") router.replace("/rifas"); });
        return () => { vivo = false; };
    }, [router]);
    return null;
}
