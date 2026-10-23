import { fetchConSesion } from "@/lib/fetchConSesion";
import { olvidarTablasCliente } from "./tablasCliente";

// El panel no ve ninguna fila de la cuadrícula de este precio. Antes de
// decir "vacía" se pregunta al backend, que cuenta las filas REALES del
// cliente del token y, solo si no tiene ninguna, pide su inicialización
// segura (migración 027: 00-99 del cliente, sin tocar otra cuadrícula).
// Nunca reinicia ni borra nada.

export type EstadoCuadricula = "vacia" | "completa" | "incompleta" | "excedida";

export interface RespuestaPreparar {
    ok: boolean;
    motivo?: string;
    migracion?: string;
    codigo?: string;
    estado?: EstadoCuadricula;
    filas?: number;
    esperadas?: number;
    tabla?: string;
}

export interface DiagnosticoCuadricula {
    // "lista": ya tiene sus filas (se debe volver a leer la tabla).
    tipo: "lista" | "bloqueada";
    titulo: string;
    mensaje: string;
}

export async function prepararCuadricula(precio: number): Promise<RespuestaPreparar> {

    try {
        const res = await fetchConSesion("/api/tablas/preparar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ precio })
        });
        const json = (await res.json().catch(() => null)) as RespuestaPreparar | null;
        if (!json) return { ok: false, motivo: "sin_respuesta" };
        if (json.ok) olvidarTablasCliente();
        return json;
    } catch {
        return { ok: false, motivo: "sin_respuesta" };
    }

}

const NO_REINICIAR = "No uses «Reiniciar»: no lo resolvería y no hace falta borrar nada.";

// Qué mostrar según la respuesta del backend. `vistas` = filas que la
// sesión del panel pudo leer.
export function diagnosticar(r: RespuestaPreparar, vistas: number): DiagnosticoCuadricula {

    if (r.ok && r.estado === "completa") {

        if (vistas === 0 && (r.filas ?? 0) > 0) {
            return {
                tipo: "bloqueada",
                titulo: "La tabla existe, pero tu sesión no puede leerla",
                mensaje: `Tus ${r.filas} números están guardados, pero el panel no tiene permiso para leerlos. No es una tabla vacía. ${NO_REINICIAR} Contacta con soporte.`
            };
        }

        return { tipo: "lista", titulo: "Cuadrícula lista", mensaje: "" };

    }

    if (r.ok && (r.estado === "incompleta" || r.estado === "excedida")) {
        return {
            tipo: "bloqueada",
            titulo: "Cuadrícula con números de más o de menos",
            mensaje: `Tu cuadrícula tiene ${r.filas} de ${r.esperadas} números. No se completa ni se corrige automáticamente para no tocar reservas ni pagos. Contacta con soporte antes de operar esta tabla.`
        };
    }

    switch (r.motivo) {

        case "migracion_pendiente":
            return {
                tipo: "bloqueada",
                titulo: "Tu cuadrícula todavía no se puede crear",
                mensaje: `Tu cuenta todavía no tiene habilitada su propia tabla de números del 00 al 99. Contacta con soporte (referencia: 027). ${NO_REINICIAR}`
            };

        case "restriccion_unica":
            return {
                tipo: "bloqueada",
                titulo: "Tu cuadrícula todavía no se puede crear",
                mensaje: `Todavía no es posible crear tu cuadrícula sin afectar a otras cuentas, así que no se ha creado nada. Contacta con soporte (referencia: 033). ${NO_REINICIAR}`
            };

        case "parte_a_pendiente":
            return {
                tipo: "bloqueada",
                titulo: "Tu cuadrícula todavía no se puede crear",
                mensaje: `Las tablas de números todavía no tienen activada la protección por cuenta, así que no se crea ninguna cuadrícula nueva. Contacta con soporte (referencia: Parte A). ${NO_REINICIAR}`
            };

        case "error_lectura":
            return {
                tipo: "bloqueada",
                titulo: "No se pudo comprobar la cuadrícula",
                mensaje: `No fue posible contar tus números${r.codigo ? ` (código ${r.codigo})` : ""}. No es una tabla vacía. ${NO_REINICIAR}`
            };

        case "tabla_no_configurada":
            return {
                tipo: "bloqueada",
                titulo: "Precio no configurado",
                mensaje: "Tu cuenta no tiene una tabla configurada para este precio."
            };

        default:
            return {
                tipo: "bloqueada",
                titulo: "No se pudo comprobar la cuadrícula",
                mensaje: `No fue posible consultar el estado de tu cuadrícula en este momento (referencia: ${r.motivo || "sin motivo"}). No es una tabla vacía. ${NO_REINICIAR}`
            };

    }

}
