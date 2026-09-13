"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { ConfigAccionSimple, guardarConfiguracion } from "@/services/automatizacion/automationConfigs";

import { Switch, SelectorCategoria, BarraGuardar } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicial: ConfigAccionSimple;
    onGuardado: (nuevo: ConfigAccionSimple) => void;
}

// 🔴 Cierre — se envía SOLO cuando el sistema de cierre real (evaluarEvento/
// verificarHoraCierre, sin cambios) ya marcó el evento como cerrado. Su
// propio guardado escribe ÚNICAMENTE mensaje_cierre.
export default function SeccionCierre({ usuarioId, grupoId, inicial, onGuardado }: Props) {

    const [valor, setValor] = useState(inicial);
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function guardar() {

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            mensaje_cierre: valor
        });

        setGuardando(false);

        if (errorGuardar || !data) {
            setError(`No se pudo guardar (${errorGuardar?.message || "error desconocido"}).`);
            return;
        }

        setGuardadoOk(true);
        onGuardado(valor);

    }

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}><Lock size={15} /> Cierre</h2>

            <p className={styles.nota}>
                El momento real del cierre nunca lo decide esta configuración — lo sigue
                decidiendo el sistema de cierre existente (evaluarEvento/verificarHoraCierre,
                sin cambios). Esto solo controla si, además, se envía un mensaje de aviso.
            </p>

            <div className={styles.actionRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Activado</span>
                <Switch on={valor.activo} label="Cierre" onClick={() => setValor({ ...valor, activo: !valor.activo })} />
            </div>

            <div className={styles.msgRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Categoría de mensaje</span>
                <SelectorCategoria valor={valor.categoria} onChange={(categoria) => setValor({ ...valor, categoria })} />
            </div>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
