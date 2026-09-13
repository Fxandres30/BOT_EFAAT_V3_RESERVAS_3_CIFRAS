"use client";

import { useState } from "react";
import { TableProperties } from "lucide-react";

import { Input } from "@/components/ui/Input";
import { ConfigPublicacionInicialTabla, guardarConfiguracion } from "@/services/automatizacion/automationConfigs";
import { DIAS_SEMANA } from "@/services/automatizacion/tiposCategorias";

import { BarraGuardar } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicial: ConfigPublicacionInicialTabla;
    onGuardado: (nuevo: ConfigPublicacionInicialTabla) => void;
}

// 🎟️ Tabla inicial (INITIAL_TABLE) — publica la imagen+texto reales de
// la tabla (mismo Compartir real que el botón manual, sin cambios). Su
// propio guardado escribe ÚNICAMENTE publicacion_inicial_tabla.
export default function SeccionTablaInicial({ usuarioId, grupoId, inicial, onGuardado }: Props) {

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
            publicacion_inicial_tabla: valor
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

            <h2 className={styles.sectionTitle}><TableProperties size={15} /> Tabla inicial</h2>

            <label className={styles.checkRow}>
                <input
                    type="checkbox"
                    checked={valor.activo}
                    onChange={(e) => setValor({ ...valor, activo: e.target.checked })}
                />
                {valor.activo ? "Activada" : "Desactivada"}
            </label>

            <div className={styles.grid2} style={{ marginTop: 12 }}>
                <Input
                    label="Hora de publicación"
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
                La hora indica cuándo se intenta publicar la primera tabla. La imagen y los
                números siempre salen del evento real detectado (mismo Compartir real del botón
                manual del panel de Tablas).
            </p>
            <p className={styles.nota}>
                Si el evento todavía no ha sido detectado, no se envía nada. Cuando el evento
                aparezca después de la hora programada, se publicará si todavía no se ha realizado.
            </p>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
