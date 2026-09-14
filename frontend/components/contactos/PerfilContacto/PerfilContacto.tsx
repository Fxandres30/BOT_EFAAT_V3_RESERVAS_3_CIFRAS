"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Phone, Hash, Clock, Loader2 } from "lucide-react";

import "./PerfilContacto.css";

import { obtenerPerfilContacto } from "@/services/contactos/obtenerPerfilContacto";
import { agregarTelefonoContacto } from "@/services/contactos/agregarTelefonoContacto";
import type { Contacto, PerfilContacto as PerfilContactoTipo } from "@/components/contactos/types";

interface Props {
    contacto: Contacto;
    usuarioId: string;
    onTelefonoAgregado: () => void;
}

const ETIQUETA_ESTADO_IDENTIFICACION: Record<string, string> = {
    completo: "Completo (LID + teléfono)",
    solo_lid: "Solo LID — teléfono pendiente",
    solo_telefono: "Solo teléfono",
    sin_identificar: "Sin identificar"
};

function formatearFechaHora(iso: string | null): string {

    if (!iso) return "—";

    const fecha = new Date(iso);

    if (Number.isNaN(fecha.getTime())) return "—";

    return fecha.toLocaleString("es-CO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });

}

function formatearHoraTs(ts: number | null): string {

    if (!ts) return "";

    return new Date(ts * 1000).toLocaleString("es-CO", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

}

const ETIQUETA_TIPO_ACTIVIDAD: Record<string, string> = {
    reservado: "Reservó",
    pagado: "Pagó",
    liberado: "Se liberó",
    bloqueado: "Se bloqueó",
    cancelado: "Se canceló",
    grupo_creado: "Grupo creado",
    grupo_modificado: "Grupo modificado",
    tabla_reiniciada: "Tabla reiniciada"
};

export default function PerfilContacto({ contacto, usuarioId, onTelefonoAgregado }: Props) {

    const [perfil, setPerfil] = useState<PerfilContactoTipo | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [formularioAbierto, setFormularioAbierto] = useState(false);
    const [telefonoInput, setTelefonoInput] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

    useEffect(() => {

        let vivo = true;

        async function cargar() {

            setCargando(true);
            setError(null);
            setFormularioAbierto(false);
            setErrorGuardar(null);

            try {

                const data = await obtenerPerfilContacto(contacto.id, usuarioId);

                if (!vivo) return;

                setPerfil(data);

            } catch (e) {

                if (!vivo) return;
                setError(e instanceof Error ? e.message : "No se pudo cargar el perfil.");

            } finally {

                if (vivo) setCargando(false);

            }

        }

        cargar();

        return () => { vivo = false; };

    }, [contacto.id, usuarioId]);

    async function enviarTelefono() {

        if (!telefonoInput.trim()) return;

        setGuardando(true);
        setErrorGuardar(null);

        const resultado = await agregarTelefonoContacto(contacto.id, telefonoInput.trim());

        setGuardando(false);

        if (!resultado.ok) {

            const mensajes: Record<string, string> = {
                telefono_invalido: "Ese número no parece un celular colombiano válido (10 dígitos, empieza en 3).",
                ya_tiene_otro_telefono: "Este contacto ya tiene un teléfono distinto guardado — no se puede reemplazar.",
                telefono_ya_asignado_a_otro: "Ese teléfono ya está asignado a otro contacto.",
                contacto_no_existe: "Este contacto ya no existe.",
                error_supabase: "Error guardando el teléfono. Intenta de nuevo."
            };

            setErrorGuardar(mensajes[resultado.motivo || ""] || "No se pudo agregar el teléfono.");
            return;

        }

        setTelefonoInput("");
        setFormularioAbierto(false);

        // Recarga el perfil (ya con el teléfono) y avisa al listado padre
        // para que también se refresque.
        const actualizado = await obtenerPerfilContacto(contacto.id, usuarioId);
        setPerfil(actualizado);
        onTelefonoAgregado();

    }

    return (

        <div className="perfil-contacto">

            <div className="perfil-header">

                <div className="perfil-avatar">
                    {(contacto.nombre || "?").charAt(0).toUpperCase()}
                </div>

                <div>
                    <h2 className="perfil-nombre">{contacto.nombre || "Sin nombre"}</h2>

                    <div className="perfil-identificadores">

                        {contacto.telefono && (
                            <span className="perfil-badge perfil-badge--telefono">
                                <Phone size={13} /> {contacto.telefono}
                            </span>
                        )}

                        {contacto.lid && (
                            <span className="perfil-badge perfil-badge--lid">
                                <Hash size={13} /> {contacto.lid}
                            </span>
                        )}

                        {contacto.telefonoPendiente && !formularioAbierto && (
                            <button
                                type="button"
                                className="perfil-badge perfil-badge--pendiente"
                                onClick={() => setFormularioAbierto(true)}
                            >
                                <AlertTriangle size={13} /> Teléfono pendiente — Agregar
                            </button>
                        )}

                    </div>

                </div>

            </div>

            {formularioAbierto && (

                <div className="perfil-form-telefono">

                    <input
                        type="tel"
                        placeholder="Ej: 3001234567"
                        value={telefonoInput}
                        onChange={(e) => setTelefonoInput(e.target.value)}
                        disabled={guardando}
                    />

                    <button type="button" onClick={enviarTelefono} disabled={guardando || !telefonoInput.trim()}>
                        {guardando ? "Guardando..." : "Guardar"}
                    </button>

                    <button
                        type="button"
                        className="perfil-form-cancelar"
                        onClick={() => { setFormularioAbierto(false); setErrorGuardar(null); }}
                        disabled={guardando}
                    >
                        Cancelar
                    </button>

                    {errorGuardar && <p className="perfil-error">{errorGuardar}</p>}

                </div>

            )}

            {cargando && (
                <p className="perfil-vacio"><Loader2 size={14} className="perfil-spin" /> Cargando perfil...</p>
            )}

            {!cargando && error && <p className="perfil-error">{error}</p>}

            {!cargando && !error && perfil && (

                <>

                    <section className="perfil-seccion">

                        <h3>Identidad</h3>

                        <dl className="perfil-datos">
                            <dt>Estado de identificación</dt>
                            <dd>{ETIQUETA_ESTADO_IDENTIFICACION[perfil.identidad.estadoIdentificacion] || perfil.identidad.estadoIdentificacion}</dd>

                            <dt>Última actividad</dt>
                            <dd>{formatearFechaHora(perfil.identidad.ultimaActividad)}</dd>

                            <dt>Contacto conocido desde</dt>
                            <dd>{formatearFechaHora(perfil.identidad.primeraVezVisto)}</dd>
                        </dl>

                    </section>

                    <section className="perfil-seccion">

                        <h3>Reservas ({perfil.reservas.length})</h3>

                        {perfil.reservas.length === 0 && (
                            <p className="perfil-vacio">Este contacto todavía no ha reservado ningún número.</p>
                        )}

                        {perfil.reservas.length > 0 && (

                            <ul className="perfil-lista-reservas">

                                {perfil.reservas.map((r, i) => (

                                    <li key={`${r.tabla}-${r.numero}-${i}`} className={`perfil-reserva perfil-reserva--${r.estado}`}>

                                        <span className="perfil-reserva-numero">{r.numero}</span>
                                        <span className="perfil-reserva-estado">{r.estado}</span>

                                        <span className="perfil-reserva-fecha">
                                            {r.estado === "pagado"
                                                ? formatearFechaHora(r.fecha_pago ? `${r.fecha_pago}T${r.hora_pago || "00:00"}` : null)
                                                : formatearFechaHora(r.fecha_reserva ? `${r.fecha_reserva}T${r.hora_reserva || "00:00"}` : null)}
                                        </span>

                                        {r.grupo_nombre && <span className="perfil-reserva-grupo">{r.grupo_nombre}</span>}

                                    </li>

                                ))}

                            </ul>

                        )}

                    </section>

                    <section className="perfil-seccion">

                        <h3><Clock size={14} /> Actividad reciente</h3>

                        {perfil.actividad.length === 0 && (
                            <p className="perfil-vacio">Sin actividad registrada.</p>
                        )}

                        {perfil.actividad.length > 0 && (

                            <ul className="perfil-lista-actividad">

                                {perfil.actividad.map((a) => (

                                    <li key={a.id}>
                                        <span className="perfil-actividad-tipo">
                                            {ETIQUETA_TIPO_ACTIVIDAD[a.tipo] || a.tipo}
                                        </span>
                                        {a.numero && <span> · #{a.numero}</span>}
                                        <span className="perfil-actividad-fecha"> · {formatearFechaHora(a.creado_en)}</span>
                                    </li>

                                ))}

                            </ul>

                        )}

                    </section>

                    {perfil.mensajes.length > 0 && (

                        <section className="perfil-seccion">

                            <h3>Mensajes recientes</h3>

                            <ul className="perfil-lista-mensajes">

                                {perfil.mensajes.map((m) => (

                                    <li key={m.id}>
                                        <span className="perfil-mensaje-texto">
                                            {m.texto || `(${m.tipo_mensaje})`}
                                        </span>
                                        <span className="perfil-mensaje-fecha">{formatearHoraTs(m.timestamp_whatsapp)}</span>
                                    </li>

                                ))}

                            </ul>

                        </section>

                    )}

                </>

            )}

        </div>

    );

}
