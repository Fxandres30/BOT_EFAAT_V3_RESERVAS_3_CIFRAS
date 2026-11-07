"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";

import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

import {
    ElementoBiblioteca,
    listarBiblioteca,
    alternarElemento,
    duplicarElemento,
    eliminarElemento
} from "@/services/mensajes/bibliotecaAutomatizacionDatos";
import { FiltrosBiblioteca, TIPOS_BIBLIOTECA, esTipoBiblioteca, resumen } from "@/services/mensajes/bibliotecaAutomatizacion";
import { cargarMensajesEjemplo } from "@/services/automatizacion/mensajesEjemplo";

import MensajeCard from "./MensajeCard";
import MensajeModal from "./MensajeModal";

import styles from "./MensajesAutomatizacion.module.css";

// Biblioteca central de los mensajes de automatización: Inicio del día,
// Apertura, Recordatorio, Actualización y Cierre. Es la ÚNICA pantalla que
// administra su contenido; Automatización decide dónde, cuándo y con qué
// condiciones se envían.
//
// Dos fuentes, sin mover datos (services/mensajes/bibliotecaAutomatizacion*):
//   automation_messages (los cuatro tipos de envío; propios y «De EFAAT»)
//   plantillas_mensaje tipo «inicio_dia» (lo que lee el Inicio del día).
// Sin categorías: los mensajes se organizan por su situación de envío. La
// categoría guardada en automation_messages se conserva intacta.

interface Props {
    usuarioId: string;
    tipoInicial?: string | null;
    // Los enlaces antiguos (?categoria=) siguen funcionando: se ignora.
    categoriaInicial?: string | null;
}

export default function MensajesAutomatizacion({ usuarioId, tipoInicial }: Props) {

    const [filtroTipo, setFiltroTipo] = useState(() => (esTipoBiblioteca(tipoInicial) ? tipoInicial as string : ""));
    const [filtroEstado, setFiltroEstado] = useState<NonNullable<FiltrosBiblioteca["estado"]>>("todos");
    const [recarga, setRecarga] = useState(0);

    // La lista vale para la combinación de filtros con la que se pidió
    // (sin setState síncrono en el efecto): mientras llega la nueva, se
    // muestra «Cargando…».
    const clave = `${usuarioId}|${filtroTipo}|${filtroEstado}|${recarga}`;
    const [cargada, setCargada] = useState<{ clave: string; mensajes: ElementoBiblioteca[]; error: string | null } | null>(null);

    const [modal, setModal] = useState<"nuevo" | ElementoBiblioteca | null>(null);
    const [procesando, setProcesando] = useState<string | null>(null);

    const [cargandoEjemplos, setCargandoEjemplos] = useState(false);
    const [avisoEjemplos, setAvisoEjemplos] = useState<string | null>(null);

    useEffect(() => {

        let vigente = true;

        listarBiblioteca(usuarioId, { tipo: filtroTipo || undefined, estado: filtroEstado }).then(({ data, error: errorCarga }) => {
            if (!vigente) return;
            setCargada({
                clave,
                mensajes: data || [],
                error: errorCarga ? `No se pudieron cargar los mensajes. ${errorCarga}.` : null
            });
        });

        return () => { vigente = false; };

    }, [clave, usuarioId, filtroTipo, filtroEstado]);

    const cargando = cargada?.clave !== clave;
    const mensajes = !cargando && cargada ? cargada.mensajes : [];
    const error = !cargando && cargada ? cargada.error : null;

    function setMensajes(cambio: (prev: ElementoBiblioteca[]) => ElementoBiblioteca[]) {
        setCargada((prev) => (prev ? { ...prev, mensajes: cambio(prev.mensajes) } : prev));
    }

    async function alternar(m: ElementoBiblioteca) {

        if (m.usuario_id !== usuarioId) return; // de EFAAT — sin controles

        setProcesando(m.clave);

        const { data } = await alternarElemento(m, !m.activo);

        setProcesando(null);

        if (data) {
            setMensajes((prev) => prev.map((x) => (x.clave === m.clave ? data : x)));
        }

    }

    async function duplicar(m: ElementoBiblioteca) {

        if (!usuarioId) return;

        setProcesando(m.clave);

        const { data } = await duplicarElemento(usuarioId, m);

        setProcesando(null);

        if (data) {
            setMensajes((prev) => [data, ...prev]);
        }

    }

    // Eliminar pide confirmación en un diálogo propio (no se borra al primer clic).
    const [porEliminar, setPorEliminar] = useState<ElementoBiblioteca | null>(null);

    async function eliminar(m: ElementoBiblioteca) {

        if (m.usuario_id !== usuarioId) return;

        setProcesando(m.clave);

        const { error: errorDel } = await eliminarElemento(m);

        setProcesando(null);

        if (!errorDel) {
            setMensajes((prev) => prev.filter((x) => x.clave !== m.clave));
        }

        setPorEliminar(null);

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

    function alGuardado(m: ElementoBiblioteca) {

        setMensajes((prev) => {

            const existe = prev.some((x) => x.clave === m.clave);

            if (existe) {
                return prev.map((x) => (x.clave === m.clave ? m : x));
            }

            return [m, ...prev];

        });

        setModal(null);

    }

    const cuenta = resumen(mensajes);

    return (

        <div className={styles.page}>

                    <SectionHeader
                        title="Mensajes de automatización"
                        description="Textos que EFAAT envía solo en tus grupos: inicio del día, apertura, recordatorios, actualizaciones y cierre. Aquí se escriben; en Automatización eliges dónde y cuándo se envían. De los mensajes activos de cada tipo se escoge uno al azar."
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
                            {cuenta.total} mensaje{cuenta.total === 1 ? "" : "s"} · {cuenta.activos} activo{cuenta.activos === 1 ? "" : "s"} ·{" "}
                            {cuenta.inactivos} inactivo{cuenta.inactivos === 1 ? "" : "s"}
                        </p>
                    )}

                    <div className={styles.filtros}>

                        <Select label="Tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                            <option value="">Todos</option>
                            {TIPOS_BIBLIOTECA.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </Select>

                        <Select
                            label="Estado"
                            value={filtroEstado}
                            onChange={(e) => setFiltroEstado(e.target.value as NonNullable<FiltrosBiblioteca["estado"]>)}
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
                                    key={m.clave}
                                    mensaje={m}
                                    esPropio={m.usuario_id === usuarioId}
                                    procesando={procesando === m.clave}
                                    onEditar={() => setModal(m)}
                                    onDuplicar={() => duplicar(m)}
                                    onAlternar={() => alternar(m)}
                                    onEliminar={() => setPorEliminar(m)}
                                />

                            ))}

                        </div>

                    )}

            <Modal
                open={!!porEliminar}
                size="sm"
                onClose={() => { if (!procesando) setPorEliminar(null); }}
                title="¿Eliminar este mensaje?"
                description={porEliminar ? `«${porEliminar.nombre}» dejará de usarse en tus envíos automáticos. Esta acción no se puede deshacer; si solo quieres dejar de usarlo, desactívalo.` : undefined}
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setPorEliminar(null)} disabled={!!procesando}>Cancelar</Button>
                        <Button variant="danger" size="sm" loading={!!procesando} onClick={() => porEliminar && eliminar(porEliminar)}>Eliminar</Button>
                    </>
                }
            />

            {modal && (

                <MensajeModal
                    usuarioId={usuarioId}
                    mensaje={modal === "nuevo" ? null : modal}
                    tipoInicial={filtroTipo || null}
                    onClose={() => setModal(null)}
                    onGuardado={alGuardado}
                />

            )}

        </div>

    );

}
