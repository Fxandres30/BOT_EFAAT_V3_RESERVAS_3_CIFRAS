"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";

import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";

import { getUser } from "@/services/auth/getUser";
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

import AutomatizacionHeader from "../AutomatizacionNav/AutomatizacionHeader";
import MensajeCard from "../MensajeCard/MensajeCard";
import MensajeModal from "../MensajeModal/MensajeModal";

import styles from "./CentroMensajes.module.css";

export default function CentroMensajes() {

    const [usuarioId, setUsuarioId] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [mensajes, setMensajes] = useState<AutomationMessage[]>([]);

    const [filtroTipo, setFiltroTipo] = useState("");
    const [filtroCategoria, setFiltroCategoria] = useState("");
    const [filtroEstado, setFiltroEstado] = useState<FiltrosMensajes["estado"]>("todos");

    const [modal, setModal] = useState<"nuevo" | AutomationMessage | null>(null);
    const [procesando, setProcesando] = useState<string | null>(null);

    const [cargandoEjemplos, setCargandoEjemplos] = useState(false);
    const [avisoEjemplos, setAvisoEjemplos] = useState<string | null>(null);

    async function cargar(uid: string) {

        setCargando(true);
        setError(null);

        const { data, error: errorCarga } = await listarMensajes(uid, {
            tipo: filtroTipo || undefined,
            categoria: filtroCategoria || undefined,
            estado: filtroEstado
        });

        if (errorCarga) {
            setError(`No se pudieron cargar los mensajes (${errorCarga.message}).`);
            setMensajes([]);
        } else {
            setMensajes((data as AutomationMessage[]) || []);
        }

        setCargando(false);

    }

    useEffect(() => {

        async function iniciar() {

            const { data } = await getUser();
            const uid = data.user?.id || null;

            setUsuarioId(uid);

            if (uid) {
                await cargar(uid);
            } else {
                setCargando(false);
            }

        }

        iniciar();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {

        if (usuarioId) {
            cargar(usuarioId);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtroTipo, filtroCategoria, filtroEstado]);

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
        await cargar(usuarioId);

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

            <AutomatizacionHeader />

            {!usuarioId && !cargando ? (

                <div className={styles.state}>Debes iniciar sesión para administrar mensajes.</div>

            ) : (

                <>

                    <SectionHeader
                        title="Centro de mensajes"
                        description="El pool de mensajes que usan REMINDER/UPDATE/CLOSE/OPEN — globales y los tuyos propios."
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

                </>

            )}

            {modal && usuarioId && (

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
