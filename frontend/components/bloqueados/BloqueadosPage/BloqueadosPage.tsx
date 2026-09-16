"use client";

import { useEffect, useState } from "react";
import { ShieldBan, Search, Unlock, Phone, Hash } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

import { getUser } from "@/services/auth/getUser";
import { listarBloqueados, desbloquear } from "@/services/bloqueados/bloqueados";
import type { Bloqueado } from "@/components/bloqueados/types";

import styles from "./BloqueadosPage.module.css";

// ==========================================================================
// Panel "Bloqueados" — bloqueo automático de WhatsApp: un contacto
// bloqueado no puede usar el bot, no puede reservar, y se expulsa
// automáticamente de cualquier grupo administrado por el bot (ver
// backend/bot/funciones/bloqueo/bloqueoParticipantesGrupo.js).
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
            setBloqueados((prev) => prev.map((b) => (b.id === bloqueado.id ? { ...b, activo: false } : b)));
        }

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
                description="Contactos bloqueados en EFAAT: no pueden usar el bot ni reservar, y se expulsan automáticamente en cuanto intentan entrar a cualquier grupo administrado por el bot."
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
                placeholder="Buscar por nombre, teléfono, LID o motivo…"
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
                                <th>Intentos</th>
                                <th>Expulsiones</th>
                                <th>Último grupo</th>
                                <th>Último intento</th>
                                <th>Estado</th>
                                <th />
                            </tr>
                        </thead>

                        <tbody>
                            {filtrados.map((b) => (

                                <tr key={b.id} className={!b.activo ? styles.filaInactiva : undefined}>

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
                                    <td>{b.intentos_ingreso}</td>
                                    <td>{b.expulsiones}</td>
                                    <td>{b.ultimo_grupo_nombre || b.ultimo_grupo_id || "—"}</td>
                                    <td>{formatearFecha(b.ultimo_intento_en)}</td>

                                    <td>
                                        {b.activo ? (
                                            <Badge tone="error">Bloqueado</Badge>
                                        ) : (
                                            <Badge tone="neutral">Desbloqueado</Badge>
                                        )}
                                    </td>

                                    <td>
                                        {b.activo && (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                leftIcon={<Unlock size={13} />}
                                                onClick={() => onDesbloquear(b)}
                                                disabled={procesandoId === b.id}
                                            >
                                                {procesandoId === b.id ? "Desbloqueando..." : "Desbloquear"}
                                            </Button>
                                        )}
                                    </td>

                                </tr>

                            ))}
                        </tbody>

                    </table>

                </div>

            )}

        </div>
    );

}
