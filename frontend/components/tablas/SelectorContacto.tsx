"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, Loader2, Phone, Users, X, Check } from "lucide-react";

import { buscarContactos, type ContactoBuscado } from "@/services/tablas/reservaManual";

export type SeleccionContacto =
    | { tipo: "existente"; contacto: ContactoBuscado }
    | { tipo: "nuevo"; nombre: string; telefono: string };

interface Props {
    seleccion: SeleccionContacto | null;
    onCambiar: (seleccion: SeleccionContacto | null) => void;
    deshabilitado?: boolean;
}

// Buscador de contactos de la reserva manual: SOLO el directorio del cliente
// de la sesión (el backend lo filtra por el token), por nombre o teléfono,
// con los grupos de WhatsApp donde se le ha visto. Si no aparece, permite
// registrar uno nuevo (el backend decide si se puede: nunca vincula un
// teléfono que ya pertenece a otra cuenta).
export default function SelectorContacto({ seleccion, onCambiar, deshabilitado = false }: Props) {

    const [q, setQ] = useState("");
    const [resultados, setResultados] = useState<ContactoBuscado[]>([]);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modoNuevo, setModoNuevo] = useState(false);
    const consulta = useRef(0);

    useEffect(() => {

        if (seleccion || modoNuevo) return;

        const id = ++consulta.current;
        const espera = setTimeout(async () => {
            setBuscando(true);
            const r = await buscarContactos(q.trim());
            if (id !== consulta.current) return;
            setBuscando(false);
            if (r.ok) { setResultados(r.contactos); setError(null); }
            else { setResultados([]); setError(r.mensaje); }
        }, q ? 300 : 0);

        return () => clearTimeout(espera);

    }, [q, seleccion, modoNuevo]);

    if (seleccion?.tipo === "existente") {

        const c = seleccion.contacto;

        return (
            <div className="border rounded-xl p-3 bg-emerald-50/60 border-emerald-200 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-semibold text-gray-900 flex items-center gap-1.5">
                        <Check size={15} className="text-emerald-600 shrink-0" />
                        <span className="truncate">{c.nombre || "Sin nombre"}</span>
                    </p>
                    <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5">
                        <Phone size={12} /> {c.telefono || (c.telefonoPendiente ? "Teléfono pendiente (solo LID)" : "Sin teléfono")}
                    </p>
                    {c.grupos.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
                            <Users size={12} className="mt-0.5 shrink-0" />
                            <span>{c.grupos.map(g => g.grupoNombre || g.grupoId).join(" · ")}</span>
                        </p>
                    )}
                </div>
                {!deshabilitado && (
                    <button type="button" onClick={() => onCambiar(null)} className="text-sm text-gray-600 hover:text-gray-900 underline shrink-0">
                        Cambiar
                    </button>
                )}
            </div>
        );

    }

    if (modoNuevo) {

        const nuevo = seleccion?.tipo === "nuevo" ? seleccion : { tipo: "nuevo" as const, nombre: "", telefono: "" };

        return (
            <div className="border rounded-xl p-3 space-y-2 bg-gray-50">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><UserPlus size={15} /> Contacto nuevo</p>
                    <button
                        type="button"
                        onClick={() => { setModoNuevo(false); onCambiar(null); }}
                        className="text-gray-500 hover:text-gray-800 p-1 -m-1"
                        aria-label="Volver a buscar"
                        disabled={deshabilitado}
                    >
                        <X size={16} />
                    </button>
                </div>
                <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Nombre"
                    value={nuevo.nombre}
                    maxLength={80}
                    disabled={deshabilitado}
                    onChange={(e) => onCambiar({ ...nuevo, nombre: e.target.value })}
                />
                <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Teléfono (ej. 300 123 4567)"
                    inputMode="tel"
                    value={nuevo.telefono}
                    maxLength={20}
                    disabled={deshabilitado}
                    onChange={(e) => onCambiar({ ...nuevo, telefono: e.target.value })}
                />
                <p className="text-xs text-gray-500">
                    Se agrega a tus contactos. Si el teléfono ya existe en tus contactos se usa ese mismo contacto, sin duplicarlo.
                </p>
            </div>
        );

    }

    return (

        <div className="space-y-2">

            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    className="w-full border rounded-xl pl-9 pr-9 py-2.5 text-sm"
                    placeholder="Buscar por nombre o teléfono"
                    value={q}
                    autoFocus
                    disabled={deshabilitado}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Buscar contacto"
                />
                {buscando && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <ul className="border rounded-xl divide-y max-h-56 overflow-y-auto" role="listbox" aria-label="Contactos">
                {resultados.map((c) => (
                    <li key={c.id}>
                        <button
                            type="button"
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 disabled:opacity-50"
                            disabled={deshabilitado}
                            onClick={() => onCambiar({ tipo: "existente", contacto: c })}
                        >
                            <span className="flex items-center justify-between gap-2">
                                <span className="font-medium text-gray-900 truncate">{c.nombre || "Sin nombre"}</span>
                                <span className="text-xs text-gray-500 shrink-0">{c.telefono || "solo LID"}</span>
                            </span>
                            {c.grupos.length > 0 && (
                                <span className="block text-xs text-gray-500 truncate mt-0.5">
                                    {c.grupos.length > 1 ? `${c.grupos.length} grupos: ` : ""}
                                    {c.grupos.map(g => g.grupoNombre || g.grupoId).join(" · ")}
                                </span>
                            )}
                        </button>
                    </li>
                ))}
                {!buscando && resultados.length === 0 && !error && (
                    <li className="px-3 py-3 text-sm text-gray-500">
                        {q ? "Ningún contacto coincide." : "Todavía no hay contactos."}
                    </li>
                )}
            </ul>

            <button
                type="button"
                disabled={deshabilitado}
                onClick={() => {
                    setModoNuevo(true);
                    const digitos = q.replace(/\D/g, "");
                    onCambiar({ tipo: "nuevo", nombre: digitos.length >= 7 ? "" : q.trim(), telefono: digitos.length >= 7 ? q.trim() : "" });
                }}
                className="text-sm text-blue-700 hover:text-blue-900 flex items-center gap-1.5"
            >
                <UserPlus size={15} /> Registrar contacto nuevo
            </button>

        </div>

    );

}
