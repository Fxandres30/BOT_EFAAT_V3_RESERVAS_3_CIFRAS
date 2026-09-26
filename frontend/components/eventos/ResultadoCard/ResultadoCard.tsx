import { Trophy } from "lucide-react";

import { formatHora12 } from "@/lib/formatHora";

import type { Evento } from "../types";
import { infoModalidad, type Modalidad } from "../modalidad";

import styles from "./ResultadoCard.module.css";

interface Props {
    evento: Evento;
    modalidad: Modalidad;
}

function fecha(iso?: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// Sorteo FINALIZADO. Hoy el proyecto no guarda número ganador en ninguna
// tabla: se muestra "Sin resultado registrado" (nunca un número inventado)
// y VER RESULTADO queda deshabilitado hasta que exista esa estructura.
export default function ResultadoCard({ evento, modalidad }: Props) {

    const info = infoModalidad(modalidad);
    const premios = Array.isArray(evento.premios) ? evento.premios.length : 0;
    const gratis = modalidad === "tres_gratis";

    return (
        <article className={`${styles.card} ${modalidad === "dos" ? "" : gratis ? styles.gratis : styles.pago}`}>

            <div className={styles.cabecera}>
                <h3 className={styles.name}>{evento.nombre_evento || "Sorteo sin nombre"}</h3>
                <span className={styles.modalidad}>{info.titulo}{modalidad === "dos" ? "" : ` · ${gratis ? "GRATIS" : "PAGO"}`}</span>
            </div>

            <p className={styles.fecha}>
                {fecha(evento.fecha_evento)} · {evento.hora_fin ? formatHora12(evento.hora_fin) : "—"}
            </p>

            <div className={styles.ganador}>
                <Trophy size={18} aria-hidden="true" />
                <span>Sin resultado registrado</span>
            </div>

            <p className={styles.datos}>
                {evento.reservados ?? 0} {gratis ? "participantes" : "números reservados"} · {premios} {premios === 1 ? "premio" : "premios"}
            </p>

            <button type="button" className={styles.boton} disabled title="El proyecto aún no registra el número ganador de los sorteos">
                Ver resultado
            </button>

        </article>
    );

}
