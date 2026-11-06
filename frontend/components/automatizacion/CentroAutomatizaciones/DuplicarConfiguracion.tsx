"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Aviso, avisar } from "@/components/ui/Avisos";
import { useAccion } from "@/hooks/useAccion";

import { AutomationConfig, aplicarAVarios, leerVersiones } from "@/services/automatizacion/automationConfigs";
import { BLOQUES_COPIA, BloqueCopia, construirCopia, validarCopia } from "@/services/automatizacion/centroAutomatizaciones";

import type { FilaGrupo } from "./filaGrupo";
import styles from "./CentroAutomatizaciones.module.css";

interface Props {
    usuarioId: string;
    origen: FilaGrupo;
    filas: FilaGrupo[];
    destinosIniciales: string[];
    onClose: () => void;
    onAplicado: (configs: AutomationConfig[]) => void;
}

// Copia partes de la configuración de un grupo a otros. Nunca toca el
// grupo de origen ni el interruptor (activo) de los destinos. Se aplica en
// una sola sentencia: a todos o a ninguno.
export default function DuplicarConfiguracion({ usuarioId, origen, filas, destinosIniciales, onClose, onAplicado }: Props) {

    const candidatos = filas.filter((f) => f.config.grupo_id !== origen.config.grupo_id);

    const [bloques, setBloques] = useState<BloqueCopia[]>(["recordatorios", "actualizacion"]);
    const [destinos, setDestinos] = useState<string[]>(destinosIniciales.filter((g) => g !== origen.config.grupo_id));
    const [confirmando, setConfirmando] = useState(false);
    const [errores, setErrores] = useState<string[]>([]);

    const aplicar = useAccion(async () => {

        const elegidos = candidatos.filter((f) => destinos.includes(f.config.grupo_id));

        const versiones = await leerVersiones(usuarioId, [origen.config.grupo_id, ...elegidos.map((f) => f.config.grupo_id)]);

        if (versiones.error || !versiones.data) throw new Error("No pudimos comprobar el estado actual de los grupos.");

        const problemas = validarCopia(
            origen.config,
            elegidos.map((f) => ({ grupo_id: f.config.grupo_id, nombre: f.nombre, actualizado_en: f.config.actualizado_en })),
            bloques,
            versiones.data
        );

        const vigenteOrigen = versiones.data[origen.config.grupo_id];

        if (!vigenteOrigen || new Date(vigenteOrigen).getTime() !== new Date(origen.config.actualizado_en).getTime()) {
            problemas.unshift(`El grupo de origen «${origen.nombre}» cambió desde que abriste esta pantalla. Actualiza y vuelve a intentarlo.`);
        }

        if (problemas.length > 0) return { problemas, configs: null };

        const res = await aplicarAVarios(usuarioId, elegidos.map((f) => f.config.grupo_id), construirCopia(origen.config, bloques));

        if (res.error || !res.data) throw new Error(`No se aplicó a ningún grupo (${res.error || "sin respuesta"}).`);

        return { problemas: [], configs: res.data };

    }, { mensajeError: "No se aplicó a ningún grupo." });

    async function onAplicar() {

        const r = await aplicar.ejecutar();

        if (!r.ok) return;

        if (r.valor.problemas.length > 0) {
            setErrores(r.valor.problemas);
            setConfirmando(false);
            return;
        }

        avisar.ok(`Configuración copiada a ${r.valor.configs?.length} grupo${r.valor.configs?.length === 1 ? "" : "s"}.`);
        onAplicado(r.valor.configs || []);
        onClose();

    }

    function alternar<T>(lista: T[], valor: T): T[] {
        return lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];
    }

    const nombresDestino = candidatos.filter((f) => destinos.includes(f.config.grupo_id)).map((f) => f.nombre);
    const etiquetasBloques = BLOQUES_COPIA.filter((b) => bloques.includes(b.id)).map((b) => b.label);

    return (

        <Modal
            open
            onClose={onClose}
            bloquearCierre={aplicar.procesando}
            size="md"
            title={`Duplicar configuración de «${origen.nombre}»`}
            description="Copia partes de esta configuración a otros grupos. El grupo de origen no cambia."
            footer={
                <div className={styles.botonesPie}>
                    {confirmando ? (
                        <>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)} disabled={aplicar.procesando}>Volver</Button>
                            <Button size="sm" onClick={onAplicar} loading={aplicar.procesando} disabled={aplicar.procesando}>
                                Reemplazar en {destinos.length} grupo{destinos.length === 1 ? "" : "s"}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
                            <Button size="sm" onClick={() => { setErrores([]); setConfirmando(true); }} disabled={bloques.length === 0 || destinos.length === 0}>
                                Continuar
                            </Button>
                        </>
                    )}
                </div>
            }
        >

            <div className={styles.editor} style={{ minHeight: 0 }}>

                {errores.length > 0 && (
                    <Aviso tono="error">
                        No se aplicó ningún cambio:
                        <ul className={styles.listaGrupos}>{errores.map((e) => <li key={e}>{e}</li>)}</ul>
                    </Aviso>
                )}

                {aplicar.error && <Aviso tono="error">{aplicar.error}</Aviso>}

                {confirmando ? (

                    <div className={styles.seccion}>
                        <p className={styles.alerta}>
                            Se reemplazará en estos grupos: {etiquetasBloques.join(", ")}. Su configuración actual de esas partes
                            se pierde. El interruptor de automatización de cada grupo no cambia.
                        </p>
                        <ul className={styles.listaGrupos}>{nombresDestino.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>
                    </div>

                ) : (

                    <>
                        <div className={styles.seccion}>
                            <span className={styles.etiqueta}>¿Qué copiar?</span>
                            <div className={styles.opciones}>
                                {BLOQUES_COPIA.map((b) => (
                                    <label key={b.id} className={styles.opcion}>
                                        <input type="checkbox" checked={bloques.includes(b.id)} onChange={() => setBloques((prev) => alternar(prev, b.id))} />
                                        {b.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className={styles.seccion}>
                            <div className={styles.filaControl}>
                                <span className={styles.etiqueta}>¿A qué grupos?</span>
                                {candidatos.length > 0 && (
                                    <button
                                        type="button"
                                        className={styles.accion}
                                        onClick={() => setDestinos(destinos.length === candidatos.length ? [] : candidatos.map((f) => f.config.grupo_id))}
                                    >
                                        {destinos.length === candidatos.length ? "Quitar todos" : "Elegir todos"}
                                    </button>
                                )}
                            </div>
                            {candidatos.length === 0 ? (
                                <p className={styles.nota}>No hay otros grupos configurados.</p>
                            ) : (
                                <div className={styles.opciones}>
                                    {candidatos.map((f) => (
                                        <label key={f.config.grupo_id} className={styles.opcion}>
                                            <input
                                                type="checkbox"
                                                checked={destinos.includes(f.config.grupo_id)}
                                                onChange={() => setDestinos((prev) => alternar(prev, f.config.grupo_id))}
                                            />
                                            {f.nombre}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>

                )}

            </div>

        </Modal>

    );

}
