"use client";

import { useRouter } from "next/navigation";
import { CalendarClock, Zap } from "lucide-react";

import { Button } from "@/components/ui";
import styles from "./Sorteos.module.css";

interface Props {
    /** «Programar sorteo» en la misma página (Programados abre su formulario). */
    onProgramar?: () => void;
    /** «Publicar ahora» en la misma página (la de sorteo instantáneo). */
    onPublicarAhora?: () => void;
}

// Las DOS formas de crear un sorteo, con los flujos de siempre: programarlo
// para más tarde (/sorteos) o publicarlo ahora (/sorteo-instantaneo). Sin
// función propia, el botón lleva a la página que abre ese formulario.
export default function AccionesCrearSorteo({ onProgramar, onPublicarAhora }: Props) {

    const router = useRouter();

    return (
        // Envoltorio propio: en móvil los dos botones bajan de línea en vez
        // de salirse de la pantalla.
        <div className={styles.accionesCrear}>
            <Button leftIcon={<CalendarClock size={16} />} variant={onProgramar || !onPublicarAhora ? "primary" : "secondary"}
                onClick={onProgramar || (() => router.push("/sorteos?nuevo=1"))}>
                Programar sorteo
            </Button>
            <Button leftIcon={<Zap size={16} />} variant={onPublicarAhora ? "primary" : "secondary"}
                onClick={onPublicarAhora || (() => router.push("/sorteo-instantaneo?nuevo=1"))}>
                {/* Distinto de «Publicar ahora» de la vista previa, que SÍ envía. */}
                Publicar sorteo ahora
            </Button>
        </div>
    );

}
