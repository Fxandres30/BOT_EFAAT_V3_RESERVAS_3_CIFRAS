"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Input } from "@/components/ui/Input";
import { ConfigAccionSimple, guardarConfiguracion } from "@/services/automatizacion/automationConfigs";

import { Switch, SelectorCategoria, BarraGuardar } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicialMensaje: ConfigAccionSimple;
    inicialUmbral: number;
    inicialCooldown: number;
    onGuardado: (nuevo: { mensaje_actualizacion: ConfigAccionSimple; umbral_reservas: number; cooldown_minutos: number }) => void;
}

// 📊 Actualización por movimiento de reservas — umbral/cooldown (sin
// cambios en cómo el Scheduler los evalúa). Su propio guardado escribe
// ÚNICAMENTE mensaje_actualizacion + umbral_reservas + cooldown_minutos —
// tres columnas propias de esta acción, ninguna de otra.
export default function SeccionActualizacion({ usuarioId, grupoId, inicialMensaje, inicialUmbral, inicialCooldown, onGuardado }: Props) {

    const [mensaje, setMensaje] = useState(inicialMensaje);
    const [umbral, setUmbral] = useState(inicialUmbral);
    const [cooldown, setCooldown] = useState(inicialCooldown);
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function guardar() {

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const cambios = { mensaje_actualizacion: mensaje, umbral_reservas: umbral, cooldown_minutos: cooldown };

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, cambios);

        setGuardando(false);

        if (errorGuardar || !data) {
            setError(`No se pudo guardar (${errorGuardar?.message || "error desconocido"}).`);
            return;
        }

        setGuardadoOk(true);
        onGuardado(cambios);

    }

    return (

        <section className={styles.section}>

            <h2 className={styles.sectionTitle}><RefreshCw size={15} /> Actualización</h2>

            <p className={styles.nota}>
                Se envía cuando entran suficientes reservas nuevas seguidas, respetando el
                cooldown — el conteo real sigue viniendo de reservas_actividad, sin cambios.
            </p>

            <div className={styles.actionRow} style={{ borderTop: "none" }}>
                <span className={styles.actionLabel}>Activada</span>
                <Switch on={mensaje.activo} label="Actualización" onClick={() => setMensaje({ ...mensaje, activo: !mensaje.activo })} />
            </div>

            <div className={styles.grid2} style={{ marginTop: 12 }}>
                <Input
                    label="Umbral (reservas nuevas)"
                    type="number"
                    min={1}
                    value={umbral}
                    onChange={(e) => setUmbral(Number(e.target.value) || 1)}
                />
                <Input
                    label="Cooldown (minutos)"
                    type="number"
                    min={1}
                    value={cooldown}
                    onChange={(e) => setCooldown(Number(e.target.value) || 1)}
                />
            </div>

            <div className={styles.msgRow}>
                <span className={styles.actionLabel}>Categoría de mensaje</span>
                <SelectorCategoria valor={mensaje.categoria} onChange={(categoria) => setMensaje({ ...mensaje, categoria })} />
            </div>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
