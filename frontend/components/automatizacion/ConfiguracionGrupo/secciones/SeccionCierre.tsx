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
            setError("No se pudo guardar. Inténtalo de nuevo en unos segundos.");
            return;
        }

        setGuardadoOk(true);
        onGuardado(valor);

    }

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}><Lock size={15} /> Cierre</h2>

            <p className={styles.nota}>
                Mensaje que EFAAT envía cuando el sorteo cierra. Este interruptor solo decide si
                se envía el aviso; la hora de cierre siempre sale del sorteo.
            </p>

            <div className={styles.actionRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Enviar mensaje de cierre</span>
                <Switch on={valor.activo} label="Cierre" onClick={() => setValor({ ...valor, activo: !valor.activo })} />
            </div>

            <div className={styles.msgRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Mensaje de la biblioteca</span>
                <SelectorCategoria tipo="CLOSE_MESSAGE" valor={valor.categoria} onChange={(categoria) => setValor({ ...valor, categoria })} />
            </div>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
