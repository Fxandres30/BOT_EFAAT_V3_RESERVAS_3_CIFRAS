"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getUser } from "@/services/auth/getUser";
import { obtenerTablasCliente, type ConfiguracionTabla } from "@/services/tablas/tablasCliente";

// Precios que ofrece el cliente de la sesión (tablas_cliente; sin
// configuración propia, los precios base de lib/tablasConfig.ts).
export default function IndiceTablas() {

    const [tablas, setTablas] = useState<ConfiguracionTabla[] | null>(null);

    useEffect(() => {

        let vivo = true;

        getUser().then(async ({ data }) => {
            const lista = await obtenerTablasCliente(data.user?.id);
            if (vivo) setTablas(lista);
        });

        return () => { vivo = false; };

    }, []);

    if (!tablas) {
        return <p className="text-gray-500">Cargando tablas...</p>;
    }

    if (tablas.length === 0) {
        return <p className="text-gray-500">Tu cuenta no tiene tablas de números configuradas.</p>;
    }

    return (

        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">

            {tablas.map(({ precio }) => (

                <Link
                    key={precio}
                    href={`/tablas/${precio}`}
                    className="bg-white border rounded-2xl p-4 sm:p-6 text-center shadow hover:shadow-lg hover:border-blue-500 transition min-w-0"
                >
                    <div className="text-xl sm:text-2xl font-bold truncate">
                        ${precio.toLocaleString("es-CO")}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                        Ver tabla
                    </div>
                </Link>

            ))}

        </div>

    );

}
