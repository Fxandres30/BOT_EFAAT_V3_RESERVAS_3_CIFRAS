"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { apiRifas } from "@/services/rifas/apiRifas";

// Con el motor de rifas independientes activo (MOTOR_RIFAS=nuevo), una
// dirección antigua por precio (/tablas/1500) abre la MISMA pantalla de
// Tablas pero de la rifa de ese precio (/tablas/<tabla_id>). Si el cliente
// tiene varias rifas de ese precio, o ninguna, vuelve al índice de Tablas
// para elegir: nunca se elige una rifa por su cuenta. Con el motor legado no
// hace nada.
export default function RedireccionMotorRifas({ precio }: { precio: number }) {
    const router = useRouter();
    useEffect(() => {
        let vivo = true;
        apiRifas.listar().then(r => {
            if (!vivo || !r.ok || r.modo !== "nuevo") return;
            const delPrecio = r.rifas.filter(x => Number(x.precio) === precio && x.activa);
            router.replace(delPrecio.length === 1 ? `/tablas/${delPrecio[0].tabla_id}` : "/tablas");
        });
        return () => { vivo = false; };
    }, [router, precio]);
    return null;
}
