import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CircleSlash, Radio, Ticket, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui/cn";
import { formatearMomento, formatearRestante } from "@/services/automatizacion/estadoProgramacion";
import type { EntradaEstadoSorteo, EstadoTarjeta } from "@/services/tablas/estadoSorteoPrecio";

import styles from "./TarjetaPrecio.module.css";

const VISIBLES = 2;

// Texto, tono e icono de cada estado. El tono también pinta la tarjeta
// (franja superior e icono) según el estado de su primera entrada.
export const ESTADO_TARJETA: Record<EstadoTarjeta, { texto: string; tono: string; icono: LucideIcon }> = {
    activo: { texto: "Sorteo activo", tono: styles.activo, icono: Radio },
    programado: { texto: "Programado", tono: styles.programado, icono: CalendarClock },
    revision: { texto: "Requiere revisión", tono: styles.revision, icono: AlertTriangle },
    sin_sorteo: { texto: "Sin sorteo activo ni programado", tono: styles.sinSorteo, icono: CircleSlash },
    no_disponible: { texto: "Estado no disponible", tono: styles.noDisponible, icono: CircleSlash }
};

interface Props {
    precio: number;
    /** null: el estado del sorteo todavía se está consultando. */
    entradas: EntradaEstadoSorteo[] | null;
    ahora: Date;
}

// Tarjeta de un precio en Reservas, con forma de boleto: la cara (precio)
// y el talón (estado del sorteo) separados por una línea perforada.
// Solo presentación: recibe el estado ya calculado (estadoSorteoPrecio).
export default function TarjetaPrecio({ precio, entradas, ahora }: Props) {

    const principal = entradas?.[0]?.estado;
    const tono = principal ? ESTADO_TARJETA[principal].tono : styles.consultando;
    const restantes = entradas ? entradas.length - VISIBLES : 0;

    return (

        <Link href={`/tablas/${precio}`} className={cn(styles.tarjeta, tono)}>

            <div className={styles.cara}>
                <div className={styles.caraFila}>
                    <span className={styles.rotulo}>Tabla de números</span>
                    <span className={styles.icono} aria-hidden="true"><Ticket size={16} /></span>
                </div>
                <div className={styles.precio}>
                    <span className={styles.moneda}>$</span>
                    <span className={styles.valor}>{precio.toLocaleString("es-CO")}</span>
                </div>
            </div>

            <div className={styles.perforado} aria-hidden="true" />

            <div className={styles.talon}>

                {!entradas ? (
                    <p className={styles.consultandoTexto} role="status">
                        <span className={styles.puntoCarga} aria-hidden="true" />
                        Consultando sorteo…
                    </p>
                ) : (
                    <div className={styles.entradas}>
                        {entradas.slice(0, VISIBLES).map(e => <Entrada key={e.clave} e={e} ahora={ahora} />)}
                        {restantes > 0 && (
                            <p className={styles.mas}>+{restantes} sorteo{restantes === 1 ? "" : "s"} más</p>
                        )}
                    </div>
                )}

                <span className={styles.abrir}>
                    Ver tabla
                    <ArrowRight size={15} className={styles.flecha} aria-hidden="true" />
                </span>

            </div>

        </Link>

    );

}

function Entrada({ e, ahora }: { e: EntradaEstadoSorteo; ahora: Date }) {

    const { texto, tono, icono: Icono } = ESTADO_TARJETA[e.estado];
    const conNombre = e.estado === "activo" || e.estado === "programado" || e.estado === "revision";

    return (
        <div className={cn(styles.entrada, tono)}>
            <span className={styles.estado}>
                {e.estado === "activo"
                    ? <span className={styles.pulso} aria-hidden="true" />
                    : <Icono size={12} aria-hidden="true" />}
                {texto}
            </span>
            {conNombre && (
                <p className={styles.nombre}>{e.nombre || "Sin nombre registrado"}</p>
            )}
            {e.estado === "activo" && e.grupos !== undefined && e.grupos > 1 && (
                <p className={styles.meta}><Users size={12} aria-hidden="true" />En {e.grupos} grupos</p>
            )}
            {e.estado === "programado" && <Programacion e={e} ahora={ahora} />}
            {e.motivo && <p className={styles.motivo}>{e.motivo}</p>}
        </div>
    );

}

// Cuenta regresiva con la fecha guardada (publicar_en). Vencida: nunca
// negativa; se dice que la publicación está pendiente.
function Programacion({ e, ahora }: { e: EntradaEstadoSorteo; ahora: Date }) {

    if (!e.publicarEn) return <p className={styles.meta}>Sin fecha de publicación registrada</p>;

    const restante = e.publicarEn.getTime() - ahora.getTime();

    return (
        <>
            <p className={styles.meta}>Publica {formatearMomento(e.publicarEn, ahora)}</p>
            <p className={styles.cuenta}>
                {e.publicando ? "Publicándose ahora" : restante > 0 ? `Faltan ${formatearRestante(restante)}` : "Publicación pendiente"}
            </p>
        </>
    );

}
