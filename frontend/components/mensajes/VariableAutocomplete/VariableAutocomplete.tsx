"use client";

import { CATEGORIAS, VariableGlobal } from "@/services/mensajes/catalogoVariablesGlobal";
import styles from "./VariableAutocomplete.module.css";

export interface ItemAutocomplete {
    definicion: VariableGlobal;
    disponible: boolean;
}

interface Props {
    items: ItemAutocomplete[];
    highlightIndex: number;
    top: number;
    left: number;
    onSelect: (item: ItemAutocomplete) => void;
    onHover: (index: number) => void;
}

// Selector global de variables — se abre al escribir "{" en EditorMensaje.
// Muestra el catálogo COMPLETO (no solo las del tipo actual), agrupado por
// categoría, con 🟢 disponible / ⚪ requiere contexto (nunca oculta estas
// últimas, ver auditoría sección 11/R). Puramente presentacional: toda la
// navegación de teclado vive en EditorMensaje, que es quien controla el
// textarea y el cursor.
export default function VariableAutocomplete({ items, highlightIndex, top, left, onSelect, onHover }: Props) {

    if (items.length === 0) {
        return null;
    }

    // Precalculado (sin mutar ninguna variable durante el render): en qué
    // índices cambia de categoría respecto al anterior, para mostrar el
    // encabezado de sección solo ahí.
    const cambiaCategoria = items.map((item, index) =>
        index === 0 || items[index - 1].definicion.categoria !== item.definicion.categoria
    );

    return (
        <div className={styles.popover} style={{ top, left }} role="listbox">

            <div className={styles.header}>🧩 Variables</div>

            <div className={styles.lista}>
                {items.map((item, index) => {

                    const mostrarCategoria = cambiaCategoria[index];
                    const cat = CATEGORIAS[item.definicion.categoria];

                    return (
                        <div key={item.definicion.key}>

                            {mostrarCategoria && (
                                <div className={styles.categoria}>
                                    {cat.emoji} {cat.label}
                                </div>
                            )}

                            <div
                                role="option"
                                aria-selected={index === highlightIndex}
                                className={`${styles.item} ${index === highlightIndex ? styles.itemActivo : ""}`}
                                onMouseEnter={() => onHover(index)}
                                onMouseDown={(e) => {
                                    // onMouseDown (no onClick) para que dispare ANTES del
                                    // blur del textarea — si no, el textarea pierde el foco
                                    // y la posición del cursor guardada deja de ser válida.
                                    e.preventDefault();
                                    onSelect(item);
                                }}
                            >
                                <span className={styles.disponibilidad}>{item.disponible ? "🟢" : "⚪"}</span>
                                <div className={styles.textos}>
                                    <span className={styles.clave}>
                                        {item.definicion.dinamica && <span title="Variable global creada desde el panel">🧩 </span>}
                                        {`{{${item.definicion.key}}}`}
                                    </span>
                                    <span className={styles.descripcion}>{item.definicion.description}</span>
                                    <span className={styles.ejemplo}>Ejemplo: {item.definicion.example}</span>
                                </div>
                            </div>

                        </div>
                    );

                })}
            </div>

        </div>
    );

}
