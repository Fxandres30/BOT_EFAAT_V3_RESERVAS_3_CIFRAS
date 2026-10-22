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
}

const MOTIVOS = [
    "El bot no registró la reserva",
    "Reserva por llamada o mensaje privado",
    "Mensaje fuera del grupo",
    "Corrección de una reserva"
];

const formatoHora = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short"
});

// Formulario de la reserva manual de un número DISPONIBLE. Rellena lo que ya
// se sabe (número, sorteo, precio, grupo cuando solo hay uno o el contacto
// solo está en uno de los grupos del sorteo) y pide únicamente el contacto,
// el grupo si hay varios, el motivo y las observaciones. El estado final, la
// fecha/hora y el operador los fija el servidor.
export default function ReservaManualForm({ contexto, onReservar }: Props) {

    const [contacto, setContacto] = useState<SeleccionContacto | null>(null);
    const [eventoElegido, setEventoElegido] = useState<string | null>(null);
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

    const contextosUsables = contexto.contextos.filter(c => c.autorizado);

    // Grupos del sorteo en los que se ha visto al contacto elegido.
    const gruposDelContacto = useMemo(() => {
        if (contacto?.tipo !== "existente") return [];
        const ids = new Set(contacto.contacto.grupos.map(g => g.grupoId));
        return contextosUsables.filter(c => c.grupoId && ids.has(c.grupoId));
    }, [contacto, contextosUsables]);

    // Grupo: el que elija el propietario; si no, el único posible.
    const eventoId = eventoElegido
        ?? (contextosUsables.length === 1 ? contextosUsables[0].eventoId : null)
        ?? (gruposDelContacto.length === 1 ? gruposDelContacto[0].eventoId : null);

    const sorteo = contexto.sorteo;
    const bloqueo = !sorteo
        ? "No hay un sorteo activo para esta tabla: no se puede reservar."
        : !sorteo.aceptaReservas
            ? "El sorteo ya no acepta reservas (cerrado o pasó la hora de cierre)."
            : contextosUsables.length === 0
                ? "Ningún grupo de este sorteo está autorizado para el bot."
                : null;

    const contactoListo = contacto?.tipo === "existente"
        || (contacto?.tipo === "nuevo" && contacto.nombre.trim().length >= 2 && contacto.telefono.replace(/\D/g, "").length >= 7);

    const listo = !bloqueo && contactoListo && eventoId && motivo.trim().length >= 3 && !enviando;

    async function enviar() {

        if (!listo || !contacto || !eventoId) return;

        setEnviando(true);
        setFallo(null);

        const r = await onReservar({
            ...(contacto.tipo === "existente"
                ? { contactoId: contacto.contacto.id }
                : { nuevoContacto: { nombre: contacto.nombre.trim(), telefono: contacto.telefono.trim() } }),
            eventoId,
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
                <Ficha etiqueta="Sorteo" valor={sorteo?.nombreEvento || "Sin sorteo activo"} />
                <Ficha etiqueta="Precio" valor={`$${contexto.precio.toLocaleString("es-CO")}`} />
                <Ficha etiqueta="Estado al guardar" valor="Reservado · pendiente de pago" />
                <Ficha etiqueta="Fecha y hora" valor={formatoHora.format(ahora)} nota="La fija el servidor al guardar" icon={CalendarClock} />
            </div>

            {bloqueo && (
                <Aviso>{bloqueo}</Aviso>
            )}

            <Campo etiqueta="Contacto" requerido>
                <SelectorContacto seleccion={contacto} onCambiar={(c) => { setContacto(c); setEventoElegido(null); setFallo(null); }} deshabilitado={enviando || Boolean(bloqueo)} />
            </Campo>

            {contextosUsables.length > 0 && (
                <Campo etiqueta="Grupo de WhatsApp" requerido>
                    {contextosUsables.length === 1 ? (
                        <p className="text-sm border rounded-xl px-3 py-2.5 bg-gray-50">{contextosUsables[0].grupoNombre || contextosUsables[0].grupoId}</p>
                    ) : (
                        <div className="space-y-1.5" role="radiogroup" aria-label="Grupo de WhatsApp">
                            {contextosUsables.map((c) => {
                                const delContacto = gruposDelContacto.some(g => g.eventoId === c.eventoId);
                                return (
                                    <label key={c.eventoId} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm cursor-pointer ${eventoId === c.eventoId ? "border-blue-500 bg-blue-50" : ""}`}>
                                        <input
                                            type="radio"
                                            name="grupo-reserva"
                                            checked={eventoId === c.eventoId}
                                            onChange={() => setEventoElegido(c.eventoId)}
                                            disabled={enviando}
                                        />
                                        <span className="flex-1 min-w-0 truncate">{c.grupoNombre || c.grupoId}</span>
                                        {delContacto && <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">contacto visto aquí</span>}
                                    </label>
                                );
                            })}
                            {contacto?.tipo === "existente" && gruposDelContacto.length > 1 && (
                                <p className="text-xs text-amber-700">El contacto está en varios grupos de este sorteo: elige en cuál hizo el pedido.</p>
                            )}
                        </div>
                    )}
                    {contexto.contextos.some(c => !c.autorizado) && (
                        <p className="text-xs text-gray-500 mt-1">Los grupos no autorizados para el bot no aparecen.</p>
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
                {enviando ? "Guardando..." : fallo?.reintentable ? "Reintentar reserva" : `Reservar el ${contexto.numero}`}
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
