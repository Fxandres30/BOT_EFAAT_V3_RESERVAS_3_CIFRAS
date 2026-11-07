"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

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

// Elige qué mensajes de la biblioteca central (/mensajes) usa la acción:
// cualquiera de su tipo o solo los de una categoría. El contenido de los
// mensajes nunca se edita en Automatización. El enlace abre la biblioteca
// ya filtrada por el tipo (y la categoría) de esta acción.
export function enlaceBiblioteca(tipo: string, categoria: string | null): string {
    const q = new URLSearchParams({ vista: "automatizacion", tipo });
    if (categoria) q.set("categoria", categoria);
    return `/mensajes?${q.toString()}`;
}

export function EnlaceBiblioteca({ tipo, categoria, texto = "Ver o editar estos mensajes en Mensajes" }: { tipo: string; categoria: string | null; texto?: string }) {
    return (
        <Link href={enlaceBiblioteca(tipo, categoria)} target="_blank" rel="noopener noreferrer" prefetch={false} className={styles.enlaceBiblioteca}>
            {texto} <ExternalLink size={12} aria-hidden="true" />
        </Link>
    );
}

export function SelectorCategoria({ tipo, valor, onChange, mostrarEnlace = true }: { tipo: string; valor: string | null; onChange: (v: string | null) => void; mostrarEnlace?: boolean }) {

    return (

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <Select
                value={valor || ""}
                onChange={(e) => onChange(e.target.value || null)}
                aria-label="Mensajes de la biblioteca que se usan"
            >
                <option value="">Cualquier mensaje activo</option>
                {CATEGORIAS_AUTOMATIZACION.map((c) => (
                    <option key={c.id} value={c.id}>Solo «{c.label}»</option>
                ))}
            </Select>
            {mostrarEnlace && <EnlaceBiblioteca tipo={tipo} categoria={valor} />}
        </div>

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
