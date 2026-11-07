"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";

import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";

import {
    AutomationMessage,
    FiltrosMensajes,
    listarMensajes,
    alternarActivo,
    duplicarMensaje,
    eliminarMensaje
} from "@/services/automatizacion/mensajesAutomation";
import { TIPOS_AUTOMATIZACION, CATEGORIAS_AUTOMATIZACION } from "@/services/automatizacion/tiposCategorias";
import { cargarMensajesEjemplo } from "@/services/automatizacion/mensajesEjemplo";

import MensajeCard from "./MensajeCard";
import MensajeModal from "./MensajeModal";

import styles from "./MensajesAutomatizacion.module.css";

// Biblioteca central de los mensajes de automatización (automation_messages:
// apertura, recordatorio, actualización y cierre). Antes vivía en
// Automatización → Mensajes; ahora es la ÚNICA pantalla que administra su
// contenido. Automatización solo elige qué mensajes usa cada envío.
// Mismos servicios y mismas reglas (RLS de 007): los globales de EFAAT no
// se editan, se duplican como copia propia.

interface Props {
    usuarioId: string;
    tipoInicial?: string | null;
    categoriaInicial?: string | null;
}

export default function MensajesAutomatizacion({ usuarioId, tipoInicial, categoriaInicial }: Props) {

    const [filtroTipo, setFiltroTipo] = useState(() => (TIPOS_AUTOMATIZACION.some((t) => t.id === tipoInicial) ? tipoInicial as string : ""));
    const [filtroCategoria, setFiltroCategoria] = useState(() => (CATEGORIAS_AUTOMATIZACION.some((c) => c.id === categoriaInicial) ? categoriaInicial as string : ""));
    const [filtroEstado, setFiltroEstado] = useState<FiltrosMensajes["estado"]>("todos");
    const [recarga, setRecarga] = useState(0);

    // La lista vale para la combinación de filtros con la que se pidió
    // (sin setState síncrono en el efecto): mientras llega la nueva, se
    // muestra «Cargando…».
    const clave = `${usuarioId}|${filtroTipo}|${filtroCategoria}|${filtroEstado}|${recarga}`;
    const [cargada, setCargada] = useState<{ clave: string; mensajes: AutomationMessage[]; error: string | null } | null>(null);

    const [modal, setModal] = useState<"nuevo" | AutomationMessage | null>(null);
    const [procesando, setProcesando] = useState<string | null>(null);

    const [cargandoEjemplos, setCargandoEjemplos] = useState(false);
    const [avisoEjemplos, setAvisoEjemplos] = useState<string | null>(null);

    useEffect(() => {

        let vigente = true;

        listarMensajes(usuarioId, {
            tipo: filtroTipo || undefined,
            categoria: filtroCategoria || undefined,
            estado: filtroEstado
        }).then(({ data, error: errorCarga }) => {
            if (!vigente) return;
            setCargada({
                clave,
                mensajes: errorCarga ? [] : ((data as AutomationMessage[]) || []),
                error: errorCarga ? `No se pudieron cargar los mensajes (${errorCarga.message}).` : null
            });
        });

        return () => { vigente = false; };

    }, [clave, usuarioId, filtroTipo, filtroCategoria, filtroEstado]);

    const cargando = cargada?.clave !== clave;
    const mensajes = !cargando && cargada ? cargada.mensajes : [];
    const error = !cargando && cargada ? cargada.error : null;

    function setMensajes(cambio: (prev: AutomationMessage[]) => AutomationMessage[]) {
        setCargada((prev) => (prev ? { ...prev, mensajes: cambio(prev.mensajes) } : prev));
    }

    async function alternar(m: AutomationMessage) {

        if (m.usuario_id !== usuarioId) return; // ajeno/global — sin controles

        setProcesando(m.id);

        const { data, error: errorAlt } = await alternarActivo(m.id, !m.activo);

        setProcesando(null);

        if (!errorAlt && data) {
            setMensajes((prev) => prev.map((x) => (x.id === m.id ? (data as AutomationMessage) : x)));
        }

    }

    async function duplicar(m: AutomationMessage) {

        if (!usuarioId) return;

        setProcesando(m.id);

        const { data, error: errorDup } = await duplicarMensaje(usuarioId, m);

        setProcesando(null);

        if (!errorDup && data) {
            setMensajes((prev) => [data as AutomationMessage, ...prev]);
        }

    }

    async function eliminar(m: AutomationMessage) {

        if (m.usuario_id !== usuarioId) return;

        if (!confirm(`¿Eliminar el mensaje "${m.nombre_interno}"?`)) return;

        setProcesando(m.id);

        const { error: errorDel } = await eliminarMensaje(m.id);

        setProcesando(null);

        if (!errorDel) {
            setMensajes((prev) => prev.filter((x) => x.id !== m.id));
        }

    }

    async function cargarEjemplos() {

        if (!usuarioId) return;

        setCargandoEjemplos(true);
        setAvisoEjemplos(null);

        const resultado = await cargarMensajesEjemplo(usuarioId);

        setCargandoEjemplos(false);

        if (resultado.error) {
            setAvisoEjemplos(`No se pudieron cargar (${resultado.error}).`);
            return;
        }

        if (resultado.yaExistian) {
            setAvisoEjemplos("Los mensajes de ejemplo ya fueron cargados.");
            return;
        }

        setAvisoEjemplos(`${resultado.cantidadTotal} mensajes de ejemplo disponibles.`);
        setRecarga((n) => n + 1);

    }

    function alGuardado(m: AutomationMessage) {

        setMensajes((prev) => {

            const existe = prev.some((x) => x.id === m.id);

            if (existe) {
                return prev.map((x) => (x.id === m.id ? m : x));
            }

            return [m, ...prev];

        });

        setModal(null);

    }

    const activos = mensajes.filter((m) => m.activo).length;

    return (

        <div className={styles.page}>


                    <SectionHeader
                        title="Mensajes de automatización"
                        description="Textos que EFAAT envía solo en tus grupos: apertura, recordatorios, actualizaciones y cierre. En Automatización eliges cuándo se envían y qué mensajes de aquí usa cada envío; de los activos del tipo (o de la categoría elegida) se escoge uno al azar."
                        actions={
                            <div className={styles.headerActions}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={cargandoEjemplos}
                                    onClick={cargarEjemplos}
                                >
                                    Cargar 100 ejemplos
                                </Button>
                                <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setModal("nuevo")}>
                                    Nuevo mensaje
                                </Button>
                            </div>
                        }
                    />

                    {avisoEjemplos && <p className={styles.aviso}>{avisoEjemplos}</p>}

                    {!cargando && (
                        <p className={styles.summary}>
                            {mensajes.length} mensaje{mensajes.length === 1 ? "" : "s"} · {activos} activo{activos === 1 ? "" : "s"} ·{" "}
                            {mensajes.length - activos} inactivo{mensajes.length - activos === 1 ? "" : "s"}
                        </p>
                    )}

                    <div className={styles.filtros}>

                        <Select label="Tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                            <option value="">Todos</option>
                            {TIPOS_AUTOMATIZACION.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </Select>

                        <Select label="Categoría" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
                            <option value="">Todas</option>
                            {CATEGORIAS_AUTOMATIZACION.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                        </Select>

                        <Select
                            label="Estado"
                            value={filtroEstado}
                            onChange={(e) => setFiltroEstado(e.target.value as FiltrosMensajes["estado"])}
                        >
                            <option value="todos">Todos</option>
                            <option value="activos">Activos</option>
                            <option value="inactivos">Inactivos</option>
                        </Select>

                    </div>

                    {error && (
                        <p className={styles.error}>
                            <AlertTriangle size={15} /> {error}
                        </p>
                    )}

                    {cargando ? (

                        <div className={styles.state}>Cargando mensajes…</div>

                    ) : mensajes.length === 0 ? (

                        <EmptyState
                            icon={<Plus size={20} />}
                            title="No hay mensajes con estos filtros"
                            description="Crea el primero con «Nuevo mensaje» o carga los 100 de ejemplo."
                        />

                    ) : (

                        <div className={styles.grid}>

                            {mensajes.map((m) => (

                                <MensajeCard
                                    key={m.id}
                                    mensaje={m}
                                    esPropio={m.usuario_id === usuarioId}
                                    procesando={procesando === m.id}
                                    onEditar={() => setModal(m)}
                                    onDuplicar={() => duplicar(m)}
                                    onAlternar={() => alternar(m)}
                                    onEliminar={() => eliminar(m)}
                                />

                            ))}

                        </div>

                    )}

            {modal && (

                <MensajeModal
                    usuarioId={usuarioId}
                    mensaje={modal === "nuevo" ? null : modal}
                    onClose={() => setModal(null)}
                    onGuardado={alGuardado}
                />

            )}

        </div>

    );

}
