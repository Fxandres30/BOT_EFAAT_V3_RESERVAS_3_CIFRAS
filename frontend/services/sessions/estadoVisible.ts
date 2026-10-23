// Qué estado se muestra en cada tarjeta de /sesiones.
//
// La única fuente del estado ACTUAL es GET /sessions/salud (socket real del
// proceso que tiene la sesión). sesiones.estado es lo último que se guardó
// en la base y puede quedar desactualizado: nunca se presenta como una
// conexión confirmada. Si la consulta de salud no respondió, la tarjeta dice
// «Verificando…» o «Sin verificar» y muestra lo guardado solo como nota.
import type { EstadoSalud, SaludSesion } from "./saludSesiones";

export type TipoEstado = "online" | "offline" | "pending" | "warning";
export type TonoMarca = "neutral" | "primary" | "error";

// Estado de la consulta de salud en el panel.
export type ConsultaSalud = "pendiente" | "ok" | "error";

export const ESTADO_SALUD: Record<EstadoSalud, { kind: TipoEstado; label: string }> = {
    saludable: { kind: "online", label: "Saludable · escuchando" },
    conectada: { kind: "online", label: "Conectada a WhatsApp" },
    conectando: { kind: "pending", label: "Conectando" },
    degradada: { kind: "warning", label: "Degradada" },
    desconectada: { kind: "offline", label: "Desconectada" },
    conflicto_lease: { kind: "warning", label: "Atendida en otro equipo" },
};

export interface EstadoVisible {
    status: { kind: TipoEstado; label: string };
    // Marca de «sesión en uso por el bot»; null si la sesión no está activa.
    marcaActiva: { tone: TonoMarca; label: string } | null;
    // Aclaración cuando el estado no está verificado.
    nota: string | null;
}

const GUARDADO: Record<string, string> = {
    conectado: "conectada",
    desconectado: "desconectada",
    esperando_qr: "esperando QR",
};

export function estadoVisibleSesion({
    salud,
    consulta,
    estadoGuardado,
    activa,
}: {
    salud: SaludSesion | null;
    consulta: ConsultaSalud;
    estadoGuardado: string;
    activa: boolean;
}): EstadoVisible {

    if (salud) {
        return {
            status: ESTADO_SALUD[salud.estado],
            marcaActiva: !activa ? null
                : salud.estado === "saludable" ? { tone: "primary", label: "En servicio" }
                : { tone: "error", label: "Activa · no está procesando" },
            nota: null,
        };
    }

    // El QR lo pide el propio usuario desde esta pantalla y llega por
    // tiempo real: se sigue mostrando para que pueda escanearlo.
    if (estadoGuardado === "esperando_qr") {
        return {
            status: { kind: "pending", label: "QR pendiente" },
            marcaActiva: activa ? { tone: "neutral", label: "En uso · sin verificar" } : null,
            nota: null,
        };
    }

    const guardado = GUARDADO[estadoGuardado] || "desconocido";

    if (consulta === "pendiente") {
        return {
            status: { kind: "pending", label: "Verificando…" },
            marcaActiva: activa ? { tone: "neutral", label: "En uso · verificando" } : null,
            nota: null,
        };
    }

    return {
        status: { kind: "warning", label: "Sin verificar" },
        marcaActiva: activa ? { tone: "neutral", label: "En uso · sin verificar" } : null,
        nota: `No pudimos comprobar la conexión ahora. Último estado guardado: ${guardado}.`,
    };

}
