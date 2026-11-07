"use client";

import { useState } from "react";
import { Bell } from "lucide-react";

import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfigRecordatorios, guardarConfiguracion } from "@/services/automatizacion/automationConfigs";

import { Switch, SelectorCategoria, BarraGuardar, EnlaceBiblioteca } from "./compartido";
import styles from "../ConfiguracionGrupo.module.css";

interface Props {
    usuarioId: string;
    grupoId: string;
    inicial: ConfigRecordatorios;
    onGuardado: (nuevo: ConfigRecordatorios) => void;
}

// 🔔 Recordatorios — offsets en minutos antes del cierre REAL del evento
// (evento.hora_cierre − offset, sin cambios en cómo se calcula). Su
// propio guardado escribe ÚNICAMENTE recordatorios.
export default function SeccionRecordatorios({ usuarioId, grupoId, inicial, onGuardado }: Props) {

    const [valor, setValor] = useState(inicial);
    const [nuevoOffset, setNuevoOffset] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [guardadoOk, setGuardadoOk] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lista = Object.entries(valor).sort((a, b) => Number(a[0]) - Number(b[0]));

    function actualizar(offset: string, cambios: Partial<{ activo: boolean; categoria: string | null }>) {

        setValor((prev) => {
            const actual = prev[offset] || { activo: false, categoria: null };
            return { ...prev, [offset]: { ...actual, ...cambios } };
        });

    }

    function quitar(offset: string) {

        setValor((prev) => {
            const copia = { ...prev };
            delete copia[offset];
            return copia;
        });

    }

    function agregar() {

        const minutos = Number(nuevoOffset);

        if (!Number.isFinite(minutos) || minutos <= 0) return;

        setValor((prev) => {

            if (prev[String(minutos)]) return prev;

            return { ...prev, [String(minutos)]: { activo: true, categoria: null } };

        });

        setNuevoOffset("");

    }

    async function guardar() {

        setGuardando(true);
        setGuardadoOk(false);
        setError(null);

        const { data, error: errorGuardar } = await guardarConfiguracion(usuarioId, grupoId, {
            recordatorios: valor
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

            <h2 className={styles.sectionTitle}><Bell size={15} /> Recordatorios</h2>

            <p className={styles.nota}>
                Cada recordatorio sale los minutos indicados antes de la hora de cierre del sorteo,
                una sola vez por sorteo.{" "}
                <EnlaceBiblioteca tipo="REMINDER_MESSAGE" categoria={null} texto="Ver los mensajes de recordatorio" />
            </p>

            <div className={styles.recordatorios}>

                {lista.length === 0 && (
                    <p className={styles.nota}>Sin recordatorios configurados todavía.</p>
                )}

                {lista.map(([offset, cfg]) => (
                    <div key={offset} className={styles.recRow} style={{ flexWrap: "wrap" }}>
                        <span className={styles.recOffset}>{offset} min antes</span>
                        <Switch
                            on={cfg.activo}
                            label={`Recordatorio ${offset} min`}
                            onClick={() => actualizar(offset, { activo: !cfg.activo })}
                        />
                        <div style={{ minWidth: 160 }}>
                            <SelectorCategoria
                                tipo="REMINDER_MESSAGE"
                                mostrarEnlace={false}
                                valor={cfg.categoria}
                                onChange={(categoria) => actualizar(offset, { categoria })}
                            />
                        </div>
                        <button className={styles.recRemove} onClick={() => quitar(offset)}>
                            Quitar
                        </button>
                    </div>
                ))}

            </div>

            <div className={styles.recNuevo}>
                <Input
                    type="number"
                    min={1}
                    placeholder="Minutos antes"
                    value={nuevoOffset}
                    onChange={(e) => setNuevoOffset(e.target.value)}
                />
                <Button size="sm" variant="secondary" onClick={agregar}>
                    Agregar
                </Button>
            </div>

            <BarraGuardar guardando={guardando} guardadoOk={guardadoOk} error={error} onGuardar={guardar} />

        </section>

    );

}
