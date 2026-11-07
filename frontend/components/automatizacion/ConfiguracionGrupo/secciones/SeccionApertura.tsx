"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";

import { ConfigAccionSimple, guardarConfiguracion } from "@/services/automatizacion/automationConfigs";

import { Switch, SelectorCategoria, BarraGuardar } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicial: ConfigAccionSimple;
    onGuardado: (nuevo: ConfigAccionSimple) => void;
}

// 🟢 Apertura — el mensaje que se envía justo después de que el grupo
// real se abre (abrirGrupo(), sin cambios). Su propio guardado escribe
// ÚNICAMENTE mensaje_apertura.
export default function SeccionApertura({ usuarioId, grupoId, inicial, onGuardado }: Props) {

    // Apertura acepta legado sin "activo" (configs guardadas antes de que
    // existiera este toggle) — se trata como activa por defecto, igual
    // que ya hacía ConfiguracionGrupo.tsx.
    const [valor, setValor] = useState<ConfigAccionSimple>({ activo: inicial.activo !== false, categoria: inicial.categoria });
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function guardar() {

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            mensaje_apertura: valor
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

            <h2 className={styles.sectionTitle}><Rocket size={15} /> Apertura</h2>

            <p className={styles.nota}>
                Mensaje que EFAAT envía al abrir el grupo para un sorteo. Este interruptor solo
                decide si se envía el mensaje; no cambia cuándo ni cómo se abre el grupo.
            </p>

            <div className={styles.actionRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Enviar mensaje de apertura</span>
                <Switch on={valor.activo} label="Apertura" onClick={() => setValor({ ...valor, activo: !valor.activo })} />
            </div>

            <div className={styles.msgRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Mensaje de la biblioteca</span>
                <SelectorCategoria tipo="OPEN_MESSAGE" valor={valor.categoria} onChange={(categoria) => setValor({ ...valor, categoria })} />
            </div>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
