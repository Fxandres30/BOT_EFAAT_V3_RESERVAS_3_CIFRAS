"use client";

import { useState } from "react";
import Link from "next/link";
import { Sunrise } from "lucide-react";

import { Input } from "@/components/ui/Input";
import {
    ConfigInicioDia,
    guardarConfiguracion
} from "@/services/automatizacion/automationConfigs";
import { DIAS_SEMANA } from "@/services/automatizacion/tiposCategorias";

import { BarraGuardar } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicial: ConfigInicioDia;
    onGuardado: (nuevo: ConfigInicioDia) => void;
}

// 🌅 Inicio del día — SU PROPIA sección, con SU PROPIO guardado. Escribe
// ÚNICAMENTE la columna mensaje_inicio_dia (backend/automation/eventRules.js
// ::evaluarInicioDia() ya la lee con esta misma forma) — nunca toca
// apertura/cierre/recordatorios/actualización/tabla inicial.
export default function SeccionInicioDia({ usuarioId, grupoId, inicial, onGuardado }: Props) {

    const [valor, setValor] = useState(inicial);
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function alternarDia(diaId: string) {
        setValor((prev) => ({
            ...prev,
            dias_permitidos: { ...prev.dias_permitidos, [diaId]: !prev.dias_permitidos[diaId] }
        }));
    }

    async function guardar() {

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            mensaje_inicio_dia: valor
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

            <h2 className={styles.sectionTitle}><Sunrise size={15} /> Inicio del día</h2>

            <p className={styles.nota}>
                Mensaje de saludo automático, independiente del ciclo del evento — no crea ni
                depende de ninguna reserva/evento detectado. Se envía como máximo una vez por día
                por grupo.
            </p>

            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={valor.activo}
                    onChange={(e) => setValor({ ...valor, activo: e.target.checked })}
                />
                {valor.activo ? "Activado" : "Desactivado"}
            </label>

            <div className={styles.grid2} style={{ marginTop: 12 }}>
                <Input
                    label="Hora de envío"
                    type="time"
                    value={valor.hora}
                    onChange={(e) => setValor({ ...valor, hora: e.target.value })}
                />
            </div>

            <div className={styles.dias}>
                {DIAS_SEMANA.map((dia) => (
                    <label key={dia.id} className={styles.dia}>
                        <input
                            type="checkbox"
                            checked={!!valor.dias_permitidos[dia.id]}
                            onChange={() => alternarDia(dia.id)}
                        />
                        {dia.label}
                    </label>
                ))}
            </div>

            <p className={styles.nota}>
                El texto se elige al azar entre las plantillas habilitadas del tipo{" "}
                <strong>Inicio del día</strong> en{" "}
                <Link href="/mensajes" className={styles.back} style={{ display: "inline" }}>Mensajes</Link>.
                Como este mensaje se envía antes de que se detecte el sorteo del día, variables
                como el nombre del evento o el premio normalmente aparecerán vacías en el texto —
                nunca se inventa un dato que todavía no existe.
            </p>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
