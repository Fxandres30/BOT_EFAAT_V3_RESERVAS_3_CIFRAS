"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, DollarSign, Eye, Unlock } from "lucide-react";

import { ESTADOS_META_VISUAL, ESTADO_INTERNO_META, bucketEstado } from "./estadoVisual";
import { accionesRapidas, type AccionRapida } from "@/services/tablas/pagoLote";
import type { EstadoNumero } from "./types";

const OPCION: Record<AccionRapida, { texto: (estado: EstadoNumero) => string; icon: typeof Eye; clase: string }> = {
    pagar: { texto: () => "Registrar pago", icon: DollarSign, clase: "text-emerald-700" },
    liberar: { texto: (e) => (e === "pagado" ? "Liberar (anula el pago)" : "Liberar reserva"), icon: Unlock, clase: "text-gray-900" },
    desbloquear: { texto: () => "Desbloquear", icon: Unlock, clase: "text-slate-700" },
    detalle: { texto: (e) => (e === "libre" ? "Ver detalle y reservar" : "Ver detalle"), icon: Eye, clase: "text-gray-700" }
};

// La etiqueta de estado de una fila de «Historial de números» como control
// explícito: abre un menú con las acciones que admite ese estado. La fila
// sigue siendo solo «expandir»; nada se ejecuta desde aquí sin pasar por
// la confirmación de la acción (DialogoOperacion o el detalle del número).
export default function AccionesNumero({ numero, estado, deshabilitado = false, onAccion }: {
    numero: string;
    estado: EstadoNumero;
    deshabilitado?: boolean;
    onAccion: (accion: AccionRapida) => void;
}) {

    const [abierto, setAbierto] = useState(false);
    const contenedor = useRef<HTMLDivElement>(null);
    const idMenu = useId();
    const acciones = accionesRapidas(estado);

    useEffect(() => {
        if (!abierto) return;
        const fuera = (e: MouseEvent) => { if (!contenedor.current?.contains(e.target as Node)) setAbierto(false); };
        const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
        document.addEventListener("mousedown", fuera);
        document.addEventListener("keydown", tecla);
        return () => {
            document.removeEventListener("mousedown", fuera);
            document.removeEventListener("keydown", tecla);
        };
    }, [abierto]);

    const elegir = (accion: AccionRapida) => { setAbierto(false); onAccion(accion); };

    return (

        <div ref={contenedor} className="relative shrink-0">

            <button
                type="button"
                onClick={() => setAbierto(a => !a)}
                disabled={deshabilitado}
                aria-haspopup="menu"
                aria-expanded={abierto}
                aria-controls={idMenu}
                aria-label={`Acciones del número ${numero} (${ESTADO_INTERNO_META[estado].label})`}
                title="Acciones"
                className={`inline-flex items-center gap-1 text-xs pl-2 pr-1.5 py-1 rounded-full border whitespace-nowrap hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${ESTADOS_META_VISUAL[bucketEstado(estado)].badge}`}
            >
                {ESTADO_INTERNO_META[estado].label}
                <ChevronDown size={13} className={`transition-transform ${abierto ? "rotate-180" : ""}`} />
            </button>

            {abierto && (
                <div id={idMenu} role="menu" aria-label={`Acciones del ${numero}`} className="absolute right-0 top-full mt-1 z-40 w-56 bg-white border rounded-xl shadow-lg py-1 text-sm">
                    {estado === "en_proceso" && (
                        <p className="px-3 py-2 text-xs text-gray-500 border-b">Retención temporal en curso: sin acciones rápidas.</p>
                    )}
                    {acciones.map(accion => {
                        const { texto, icon: Icon, clase } = OPCION[accion];
                        return (
                            <button key={accion} type="button" role="menuitem" onClick={() => elegir(accion)} className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 ${clase}`}>
                                <Icon size={15} className="shrink-0" /> {texto(estado)}
                            </button>
                        );
                    })}
                </div>
            )}

        </div>

    );

}
