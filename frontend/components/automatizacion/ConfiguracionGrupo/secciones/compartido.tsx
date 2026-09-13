"use client";

import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { CATEGORIAS_AUTOMATIZACION } from "@/services/automatizacion/tiposCategorias";

import styles from "../ConfiguracionGrupo.module.css";

// Piezas de UI compartidas por las 8 secciones de configuración — antes
// vivían solo dentro de ConfiguracionGrupo.tsx; se extraen aquí para que
// cada sección (ahora un archivo independiente, con su propio guardado)
// pueda reutilizarlas sin duplicar el código ni el CSS.

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            className={`${styles.switch} ${on ? styles.switchOn : ""}`}
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onClick}
        />
    );
}

export function Dot({ on }: { on: boolean }) {
    return (
        <StatusBadge status={on ? "active" : "inactive"} label={on ? "Sí" : "No"} size="sm" />
    );
}

export function SelectorCategoria({ valor, onChange }: { valor: string | null; onChange: (v: string | null) => void }) {

    return (

        <Select
            value={valor || ""}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">Sin categoría (cualquiera)</option>
            {CATEGORIAS_AUTOMATIZACION.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
            ))}
        </Select>

    );

}

// Barra de guardado independiente por sección — mismo estilo visual que
// ya usaba el único botón global, pero uno por acción, para que guardar
// una nunca dependa ni afecte el estado de las demás.
export function BarraGuardar({
    guardando,
    guardadoOk,
    error,
    onGuardar
}: {
    guardando: boolean;
    guardadoOk: boolean;
    error: string | null;
    onGuardar: () => void;
}) {

    return (

        <div className={styles.saveBar} style={{ position: "static", background: "none", justifyContent: "flex-start", gap: 12, alignItems: "center" }}>

            <SaveButton guardando={guardando} onGuardar={onGuardar} />

            {error && <p className={styles.noteError} style={{ margin: 0 }}>{error}</p>}
            {guardadoOk && <p className={styles.noteOk} style={{ margin: 0 }}>Guardado.</p>}

        </div>

    );

}

function SaveButton({ guardando, onGuardar }: { guardando: boolean; onGuardar: () => void }) {
    return (
        <Button disabled={guardando} loading={guardando} onClick={onGuardar} size="sm">
            Guardar
        </Button>
    );
}
