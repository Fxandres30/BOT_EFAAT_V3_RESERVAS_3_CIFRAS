"use client";

import { Fragment, useEffect, useState } from "react";
import { ShieldBan, Search, Unlock, Phone, Hash, ChevronDown, ChevronUp } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

import { getUser } from "@/services/auth/getUser";
import { listarBloqueados, desbloquear } from "@/services/bloqueados/bloqueados";
import type { Bloqueado } from "@/components/bloqueados/types";
import { ChipExpulsion, DetalleExpulsion } from "@/components/bloqueados/EstadoExpulsion/EstadoExpulsion";

import styles from "./BloqueadosPage.module.css";

// ==========================================================================
// Panel "Bloqueados" — un contacto bloqueado no recibe respuestas
// automáticas, no puede reservar y se retira de los grupos autorizados de
// la cuenta. La columna «Expulsión» es el estado REAL por grupo (verificado
// con la lista de participantes), distinto del bloqueo registrado (ver
// backend/bot/funciones/bloqueo/procesarExpulsion.js).
//
// UN SOLO CONCEPTO DE NEGOCIO: "bloqueado" — no existe un panel/tabla
// separado de "vetados".
// ==========================================================================

function formatearFecha(iso: string | null): string {

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

export default function BloqueadosPage() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargandoUsuario, setCargandoUsuario] = useState(true);

    const [bloqueados, setBloqueados] = useState<Bloqueado[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [busqueda, setBusqueda] = useState("");
    const [mostrarDesbloqueados, setMostrarDesbloqueados] = useState(false);
    const [procesandoId, setProcesandoId] = useState<string | null>(null);
    const [abiertoId, setAbiertoId] = useState<string | null>(null);

    useEffect(() => {

        async function cargarUsuario() {
            const { data } = await getUser();
            setUsuarioId(data.user?.id || null);
            setCargandoUsuario(false);
        }

        cargarUsuario();

    }, []);

    useEffect(() => {

        if (!usuarioId) return;

        async function cargar() {

            setCargando(true);
            setError(null);

            try {

                const data = await listarBloqueados(usuarioId!);
                setBloqueados(data);

            } catch (e) {

                setError(e instanceof Error ? e.message : "No se pudo cargar la lista de bloqueados.");
                setBloqueados([]);

            } finally {

                setCargando(false);

            }

        }

        cargar();

    }, [usuarioId]);

    async function onDesbloquear(bloqueado: Bloqueado) {

        if (!usuarioId) return;

        setProcesandoId(bloqueado.id);

        const resultado = await desbloquear(bloqueado.id, usuarioId);

        setProcesandoId(null);

        if (resultado.ok) {
            setBloqueados((prev) => prev.map((b) => (b.id === bloqueado.id
                ? { ...b, activo: false, expulsion: b.expulsion ? { ...b.expulsion, estado: "desbloqueado" } : b.expulsion }
                : b)));
        }

    }

    // El detalle desplegado refresca el resumen de su fila.
    function actualizarResumen(id: string, expulsion: Bloqueado["expulsion"]) {
        setBloqueados((prev) => prev.map((b) => (b.id === id ? { ...b, expulsion } : b)));
    }

    const filtrados = bloqueados
        .filter((b) => mostrarDesbloqueados || b.activo)
        .filter((b) => {

            if (!busqueda.trim()) return true;

            const q = busqueda.trim().toLowerCase();

            return [b.nombre, b.telefono, b.lid, b.motivo]
                .filter(Boolean)
                .some((campo) => String(campo).toLowerCase().includes(q));

        });

    const activos = bloqueados.filter((b) => b.activo).length;

    if (cargandoUsuario) {
        return <div className={styles.state}>Cargando…</div>;
    }

    return (
        <div className={styles.page}>

            <PageHeader
                icon={<ShieldBan size={20} />}
                title="🚫 Bloqueados"
                description="Contactos bloqueados en EFAAT: no reciben respuestas automáticas ni pueden reservar, y se retiran de los grupos autorizados de tu cuenta. La expulsión solo figura como hecha cuando WhatsApp la confirma en la lista real del grupo."
            />

            <div className={styles.resumen}>

                <span className={styles.contador}>
                    <strong>{activos}</strong> bloqueado{activos === 1 ? "" : "s"} activo{activos === 1 ? "" : "s"}
                </span>

                <label className={styles.toggleHistorial}>
                    <input
                        type="checkbox"
                        checked={mostrarDesbloqueados}
                        onChange={(e) => setMostrarDesbloqueados(e.target.checked)}
                    />
                    Mostrar desbloqueados
                </label>

            </div>

            <Input
                leftIcon={<Search size={14} />}
                placeholder="Buscar por nombre, teléfono, identificador de WhatsApp o motivo…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
            />

            {error && <p className={styles.avisoTecnico}>{error}</p>}

            {cargando ? (

                <div className={styles.state}>Cargando…</div>

            ) : filtrados.length === 0 ? (

                <EmptyState
                    icon={<ShieldBan size={22} />}
                    title="🚫 No hay bloqueados"
                    description={
                        bloqueados.length === 0
                            ? "Todavía no has bloqueado a ningún contacto. Bloquear un contacto se hace desde su ficha en Contactos."
                            : "Ningún bloqueado coincide con la búsqueda/filtro actual."
                    }
                />

            ) : (

                <div className={styles.tablaWrap}>

                    <table className={styles.tabla}>

                        <thead>
                            <tr>
                                <th>Contacto</th>
                                <th>Motivo</th>
                                <th>Bloqueado desde</th>
                                <th>Estado</th>
                                <th>Expulsión de grupos</th>
                                <th>Último intento</th>
                                <th />
                            </tr>
                        </thead>

                        <tbody>
                            {filtrados.map((b) => (

                                <Fragment key={b.id}>

                                <tr className={!b.activo ? styles.filaInactiva : undefined}>

                                    <td>
                                        <div className={styles.contactoCelda}>
                                            <span className={styles.contactoNombre}>{b.nombre || "Sin nombre"}</span>
                                            <span className={styles.contactoIdentificadores}>
                                                {b.telefono && <span><Phone size={11} /> {b.telefono}</span>}
                                                {b.lid && <span><Hash size={11} /> {b.lid}</span>}
                                            </span>
                                        </div>
                                    </td>

                                    <td>{b.motivo || "—"}</td>
                                    <td>{formatearFecha(b.creado_en)}</td>

                                    <td>
                                        {b.activo ? (
                                            <Badge tone="error">Bloqueado</Badge>
                                        ) : (
                                            <Badge tone="neutral">Desbloqueado</Badge>
                                        )}
                                    </td>

                                    <td>{b.activo ? <ChipExpulsion resumen={b.expulsion} /> : "—"}</td>
                                    <td>{formatearFecha(b.ultimo_intento_en)}</td>

                                    <td>
                                        <div className={styles.accionesFila}>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                leftIcon={abiertoId === b.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                onClick={() => setAbiertoId(abiertoId === b.id ? null : b.id)}
                                                aria-expanded={abiertoId === b.id}
                                            >
                                                Detalle
                                            </Button>
                                            {b.activo && (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    leftIcon={<Unlock size={13} />}
                                                    onClick={() => onDesbloquear(b)}
                                                    loading={procesandoId === b.id}
                                                    loadingText="Desbloqueando…"
                                                >
                                                    Desbloquear
                                                </Button>
                                            )}
                                        </div>
                                    </td>

                                </tr>

                                {abiertoId === b.id && (
                                    <tr className={styles.filaDetalle}>
                                        <td colSpan={7}>
                                            <DetalleExpulsion
                                                bloqueadoId={b.id}
                                                onActualizado={(d) => actualizarResumen(b.id, d.expulsion)}
                                            />
                                        </td>
                                    </tr>
                                )}

                                </Fragment>

                            ))}
                        </tbody>

                    </table>

                </div>

            )}

        </div>
    );

}
