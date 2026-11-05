"use client";

// Botón flotante «Volver arriba» de la landing. Componente aislado: no
// modifica el resto de secciones. Aparece al bajar del umbral, desaparece al
// volver arriba y respeta prefers-reduced-motion (salto sin animación).

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

import styles from "./volverArriba.module.css";

// Desplazamiento (px) a partir del cual se muestra el botón.
const UMBRAL = 320;

export default function VolverArriba() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        let pendiente = false;
        const revisar = () => {
            pendiente = false;
            setVisible(window.scrollY > UMBRAL);
        };
        const alDesplazar = () => {
            if (pendiente) return;
            pendiente = true;
            window.requestAnimationFrame(revisar);
        };
        revisar();
        window.addEventListener("scroll", alDesplazar, { passive: true });
        return () => window.removeEventListener("scroll", alDesplazar);
    }, []);

    const subir = () => {
        const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reducir ? "auto" : "smooth" });
    };

    return (
        <button
            type="button"
            onClick={subir}
            className={`${styles.boton} ${visible ? styles.visible : ""}`}
            aria-label="Volver arriba"
            title="Volver arriba"
            aria-hidden={!visible}
            tabIndex={visible ? 0 : -1}
        >
            <ArrowUp size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
    );
}
