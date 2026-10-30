"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, Loader2, RotateCcw, Ticket } from "lucide-react";

import SelectorContacto, { type SeleccionContacto } from "./SelectorContacto";
import {
    nuevaSolicitudId,
    type ContextoNumero,
    type DatosReserva,
    type Resultado
} from "@/services/tablas/reservaManual";

interface Props {
    contexto: ContextoNumero;
    onReservar: (datos: DatosReserva) => Promise<Resultado>;
    /** Texto del botón (reserva de varios números: «Reservar 5 números»). */
    etiquetaBoton?: string;
}

const MOTIVOS = [
    "La reserva no se registró automáticamente",
    "Reserva por llamada o mensaje privado",
    "Mensaje fuera del grupo",
    "Corrección de una reserva",
    "Reserva antes de publicar el sorteo"
];

const formatoHora = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short"
});

// Grupo elegible del sorteo elegido: id para elegirlo, y lo que se envía.
interface OpcionGrupo {
    clave: string;
    grupoId: string | null;
    grupoNombre: string | null;
    datos: Pick<DatosReserva, "eventoId" | "sorteoProgramadoId" | "grupoId">;
}

// Sorteo al que va la reserva: el ACTIVO de esta tabla o uno PROGRAMADO que
// todavía no se publicó (reserva anticipada). Nunca se deduce por el grupo.
interface OpcionSorteo {
    clave: string;
    nombre: string;
    detalle: string | null;
    usable: boolean;
    motivo: string | null;
    grupos: OpcionGrupo[];
}

function opcionesDe(contexto: ContextoNumero): OpcionSorteo[] {

    const opciones: OpcionSorteo[] = [];
    const s = contexto.sorteo;

    if (s) {
        const grupos = contexto.contextos.filter(c => c.autorizado).map(c => ({
            clave: c.eventoId, grupoId: c.grupoId, grupoNombre: c.grupoNombre, datos: { eventoId: c.eventoId }
        }));
        opciones.push({
            clave: "activo",
            nombre: s.nombreEvento || "Sorteo activo",
            detalle: "Sorteo activo",
            usable: s.aceptaReservas && grupos.length > 0,
            motivo: !s.aceptaReservas ? "El sorteo ya no acepta reservas (cerrado o pasó la hora de cierre)."
                : grupos.length === 0 ? "Ningún grupo de este sorteo está autorizado en EFAAT." : null,
            grupos
        });
    }

    for (const p of contexto.programados ?? []) {
        const grupos = p.grupos.filter(g => g.autorizado).map(g => ({
            clave: g.grupoId, grupoId: g.grupoId, grupoNombre: g.grupoNombre,
            datos: { sorteoProgramadoId: p.sorteoId, grupoId: g.grupoId }
        }));
        opciones.push({
            clave: `programado:${p.sorteoId}`,
            nombre: p.nombreEvento || "Sorteo programado",
            detalle: `Programado · se publica ${formatoHora.format(new Date(p.publicarEn))}`,
            usable: p.aceptaReservas && grupos.length > 0,
            motivo: p.motivo || (grupos.length === 0 ? "Ningún grupo de este sorteo está autorizado en EFAAT." : null),
            grupos
        });
    }

    return opciones;

}

// Formulario de la reserva manual de un número DISPONIBLE. Rellena lo que ya
// se sabe (número, precio, sorteo y grupo cuando solo hay uno posible) y pide
// el sorteo si hay varios (activo o programados sin publicar), el grupo, el
// contacto, el motivo y las observaciones. El estado final, la fecha/hora y
// el operador los fija el servidor.
export default function ReservaManualForm({ contexto, onReservar, etiquetaBoton }: Props) {

    const [contacto, setContacto] = useState<SeleccionContacto | null>(null);
    const [sorteoElegido, setSorteoElegido] = useState<string | null>(null);
    const [grupoElegido, setGrupoElegido] = useState<string | null>(null);
    const [motivo, setMotivo] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [fallo, setFallo] = useState<{ mensaje: string; reintentable: boolean } | null>(null);
    // Un id por intento de reserva: un reintento tras un fallo de red usa el
    // mismo, y el servidor reconoce la reserva que ya hubiera quedado guardada.
    const [solicitudId] = useState(nuevaSolicitudId);
    const [ahora, setAhora] = useState(() => new Date());

    useEffect(() => {
        const t = setInterval(() => setAhora(new Date()), 30_000);
        return () => clearInterval(t);
    }, []);

    const opciones = useMemo(() => opcionesDe(contexto), [contexto]);
    const usables = opciones.filter(o => o.usable);

    // Sorteo: el que elija el propietario; si no, el único posible.
    const sorteo = usables.find(o => o.clave === sorteoElegido) ?? (usables.length === 1 ? usables[0] : null);
    const grupos = sorteo?.grupos ?? [];

    // Grupos del sorteo elegido en los que se ha visto al contacto.
    const idsDelContacto = new Set(contacto?.tipo === "existente" ? contacto.contacto.grupos.map(g => g.grupoId) : []);
    const gruposDelContacto = grupos.filter(g => g.grupoId && idsDelContacto.has(g.grupoId));

    // Grupo: el que elija el propietario; si no, el único posible.
    const grupo = grupos.find(g => g.clave === grupoElegido)
        ?? (grupos.length === 1 ? grupos[0] : null)
        ?? (gruposDelContacto.length === 1 ? gruposDelContacto[0] : null);

    const bloqueo = usables.length === 0
        ? (opciones.length === 0
            ? "No hay un sorteo activo ni programado para esta tabla: no se puede reservar."
            : opciones.map(o => `${o.nombre}: ${o.motivo}`).join(" "))
        : null;

    const contactoListo = contacto?.tipo === "existente"
        || (contacto?.tipo === "nuevo" && contacto.nombre.trim().length >= 2 && contacto.telefono.replace(/\D/g, "").length >= 7);

    const listo = !bloqueo && sorteo && grupo && contactoListo && motivo.trim().length >= 3 && !enviando;

    async function enviar() {

        if (!listo || !contacto || !grupo) return;

        setEnviando(true);
        setFallo(null);

        const r = await onReservar({
            ...(contacto.tipo === "existente"
                ? { contactoId: contacto.contacto.id }
                : { nuevoContacto: { nombre: contacto.nombre.trim(), telefono: contacto.telefono.trim() } }),
            ...grupo.datos,
            motivo: motivo.trim(),
            observaciones: observaciones.trim() || undefined,
            solicitudId
        });

        setEnviando(false);

        if (!r.ok) {
            setFallo({
                mensaje: r.mensaje,
                reintentable: r.motivo.startsWith("error") || r.motivo.startsWith("backend") || r.motivo === "red" || r.motivo.startsWith("http_5")
            });
        }

    }

    return (

        <div className="space-y-4">

            <div className="grid grid-cols-2 gap-2 text-sm">
                <Ficha etiqueta="Sorteo" valor={sorteo?.nombre || (usables.length > 1 ? "Elige el sorteo" : "Sin sorteo disponible")} nota={sorteo?.detalle ?? undefined} />
                <Ficha etiqueta="Precio" valor={`$${contexto.precio.toLocaleString("es-CO")}`} />
                <Ficha etiqueta="Estado al guardar" valor="Reservado · pendiente de pago" />
                <Ficha etiqueta="Fecha y hora" valor={formatoHora.format(ahora)} nota="La fija el servidor al guardar" icon={CalendarClock} />
            </div>

            {bloqueo && (
                <Aviso>{bloqueo}</Aviso>
            )}

            {opciones.length > 1 && (
                <Campo etiqueta="Sorteo" requerido>
                    <div className="space-y-1.5" role="radiogroup" aria-label="Sorteo">
                        {opciones.map((o) => (
                            <label key={o.clave} className={`flex items-start gap-2 border rounded-xl px-3 py-2 text-sm ${o.usable ? "cursor-pointer" : "opacity-60"} ${sorteo?.clave === o.clave ? "border-blue-500 bg-blue-50" : ""}`}>
                                <input
                                    type="radio"
                                    name="sorteo-reserva"
                                    className="mt-0.5"
                                    checked={sorteo?.clave === o.clave}
                                    onChange={() => { setSorteoElegido(o.clave); setGrupoElegido(null); setFallo(null); }}
                                    disabled={enviando || !o.usable}
                                />
                                <span className="flex-1 min-w-0">
                                    <span className="block truncate font-medium">{o.nombre}</span>
                                    <span className="block text-xs text-gray-500">{o.usable ? o.detalle : o.motivo}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                    {sorteo?.clave.startsWith("programado:") && (
                        <p className="text-xs text-gray-500 mt-1">Reserva anticipada: queda guardada para este sorteo y se mantiene cuando se publique.</p>
                    )}
                </Campo>
            )}

            <Campo etiqueta="Contacto" requerido>
                <SelectorContacto seleccion={contacto} onCambiar={(c) => { setContacto(c); setGrupoElegido(null); setFallo(null); }} deshabilitado={enviando || Boolean(bloqueo)} />
            </Campo>

            {grupos.length > 0 && (
                <Campo etiqueta="Grupo de WhatsApp" requerido>
                    {grupos.length === 1 ? (
                        <p className="text-sm border rounded-xl px-3 py-2.5 bg-gray-50">{grupos[0].grupoNombre || grupos[0].grupoId}</p>
                    ) : (
                        <div className="space-y-1.5" role="radiogroup" aria-label="Grupo de WhatsApp">
                            {grupos.map((g) => {
                                const delContacto = gruposDelContacto.some(x => x.clave === g.clave);
                                return (
                                    <label key={g.clave} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm cursor-pointer ${grupo?.clave === g.clave ? "border-blue-500 bg-blue-50" : ""}`}>
                                        <input
                                            type="radio"
                                            name="grupo-reserva"
                                            checked={grupo?.clave === g.clave}
                                            onChange={() => setGrupoElegido(g.clave)}
                                            disabled={enviando}
                                        />
                                        <span className="flex-1 min-w-0 truncate">{g.grupoNombre || g.grupoId}</span>
                                        {delContacto && <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">contacto visto aquí</span>}
                                    </label>
                                );
                            })}
                            {contacto?.tipo === "existente" && gruposDelContacto.length > 1 && (
                                <p className="text-xs text-amber-700">El contacto está en varios grupos de este sorteo: elige en cuál hizo el pedido.</p>
                            )}
                        </div>
                    )}
                    {(sorteo?.clave === "activo"
                        ? contexto.contextos.some(c => !c.autorizado)
                        : (contexto.programados ?? []).some(p => `programado:${p.sorteoId}` === sorteo?.clave && p.grupos.some(g => !g.autorizado))) && (
                        <p className="text-xs text-gray-500 mt-1">Los grupos no autorizados en EFAAT no aparecen.</p>
                    )}
                </Campo>
            )}

            <Campo etiqueta="Motivo de la intervención manual" requerido>
                <input
                    className="w-full border rounded-xl px-3 py-2.5 text-sm"
                    value={motivo}
                    maxLength={500}
                    disabled={enviando}
                    placeholder="¿Por qué se registra a mano?"
                    onChange={(e) => setMotivo(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {MOTIVOS.map((m) => (
                        <button key={m} type="button" disabled={enviando} onClick={() => setMotivo(m)} className={`text-xs px-2.5 py-1 rounded-full border ${motivo === m ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                            {m}
                        </button>
                    ))}
                </div>
            </Campo>

            <Campo etiqueta="Observaciones">
                <textarea
                    className="w-full border rounded-xl px-3 py-2.5 text-sm min-h-[72px]"
                    value={observaciones}
                    maxLength={1000}
                    disabled={enviando}
                    placeholder="Opcional"
                    onChange={(e) => setObservaciones(e.target.value)}
                />
            </Campo>

            {fallo && (
                <Aviso>
                    <span>{fallo.mensaje}</span>
                    {fallo.reintentable && <span className="block text-xs mt-1">Puedes reintentar: si la reserva ya se guardó, no se duplicará.</span>}
                </Aviso>
            )}

            <button
                type="button"
                onClick={enviar}
                disabled={!listo}
                className="w-full flex items-center justify-center gap-2 text-white text-sm px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
                {enviando ? <Loader2 size={15} className="animate-spin" /> : fallo?.reintentable ? <RotateCcw size={15} /> : <Ticket size={15} />}
                {enviando ? "Guardando..." : fallo?.reintentable ? "Reintentar reserva" : etiquetaBoton || `Reservar el ${contexto.numero}`}
            </button>

            <p className="text-xs text-gray-500 text-center">No se envía ningún mensaje por WhatsApp.</p>

        </div>

    );

}

function Campo({ etiqueta, requerido = false, children }: { etiqueta: string; requerido?: boolean; children: ReactNode }) {
    return (
        <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">
                {etiqueta}{requerido && <span className="text-red-600"> *</span>}
            </p>
            {children}
        </div>
    );
}

function Ficha({ etiqueta, valor, nota, icon: Icon }: { etiqueta: string; valor: string; nota?: string; icon?: typeof CalendarClock }) {
    return (
        <div className="border rounded-xl px-3 py-2 bg-gray-50 min-w-0">
            <p className="text-xs text-gray-500 flex items-center gap-1">{Icon && <Icon size={12} />}{etiqueta}</p>
            <p className="font-medium text-gray-900 truncate">{valor}</p>
            {nota && <p className="text-[11px] text-gray-400">{nota}</p>}
        </div>
    );
}

export function Aviso({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">{children}</div>
        </div>
    );
}
