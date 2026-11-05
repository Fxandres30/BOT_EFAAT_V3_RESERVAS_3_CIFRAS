// ==========================================================================
// Estado completo de la demostración (chat + panel del organizador) como un
// reducer PURO. Solo vive en la memoria del navegador: se pierde al recargar
// la página o al pulsar «Reiniciar». No hay WhatsApp, Supabase ni fetch.
//
// La interpretación de cada mensaje está en simuladorDemo.ts; aquí solo se
// encadenan sus resultados con el chat y los avisos del panel.
// ==========================================================================

import {
    EVENTO_DEMO,
    PRECIO_DEMO,
    confirmarPagoDe,
    crearTablaInicial,
    liberarNumeros,
    listaNumeros,
    marcarPagados,
    numerosDe,
    procesarMensaje
} from "./simuladorDemo";
import type { TablaDemo } from "./simuladorDemo";
import { formatearCOP } from "@/lib/comercial/planes";

export const ORGANIZADOR = "Organizador";

export type MensajeChat =
    | { id: number; clase: "texto"; autor: string; texto: string; reaccion: string | null }
    | { id: number; clase: "bot"; texto: string }
    | { id: number; clase: "sistema"; texto: string }
    | { id: number; clase: "nota"; texto: string }
    | { id: number; clase: "comprobante"; autor: string; numeros: number[] }
    | { id: number; clase: "sticker"; autor: string; dePago: boolean; cita: { autor: string; texto: string } | null };

export type TipoAviso =
    | "reserva"
    | "comprobante"
    | "aviso_pago"
    | "solicitud_liberar"
    | "pago_confirmado"
    | "pago_rechazado"
    | "liberado";

export interface Aviso {
    id: number;
    tipo: TipoAviso;
    participante: string;
    numeros: number[];
    // Mensaje del chat que originó el aviso (para citarlo con el sticker).
    mensajeId: number | null;
    // pendiente = el organizador debe decidir; resuelto = ya decidió;
    // info = solo informa.
    estado: "pendiente" | "resuelto" | "info";
}

export interface SesionDemo {
    tabla: TablaDemo;
    mensajes: MensajeChat[];
    // Más reciente primero.
    avisos: Aviso[];
    resaltados: number[];
    // Mensaje de participante esperando la respuesta automática.
    enEspera: { mensajeId: number; autor: string; texto: string } | null;
    siguienteId: number;
}

export type AccionDemo =
    | { tipo: "enviar"; autor: string; texto: string }
    | { tipo: "responder" }
    | { tipo: "comprobante"; autor: string }
    | { tipo: "sticker"; autor: string }
    | { tipo: "aprobar"; avisoId: number }
    | { tipo: "rechazar"; avisoId: number }
    | { tipo: "liberar"; numeros: number[]; avisoId?: number }
    | { tipo: "mantener"; avisoId: number }
    | { tipo: "pagar"; numeros: number[] }
    | { tipo: "reiniciar" };

const PAGO: ReadonlyArray<TipoAviso> = ["comprobante", "aviso_pago"];

export function crearSesion(): SesionDemo {
    return {
        tabla: crearTablaInicial(),
        mensajes: [{
            id: 1,
            clase: "sistema",
            texto: `EFAAT publicó la tabla del ${EVENTO_DEMO.toLowerCase()} · valor por número ${formatearCOP(PRECIO_DEMO)}`
        }],
        avisos: [],
        resaltados: [],
        enEspera: null,
        siguienteId: 2
    };
}

// Texto de un aviso del panel.
export function textoAviso(a: Aviso): string {
    const n = listaNumeros(a.numeros);
    const plural = a.numeros.length !== 1;
    switch (a.tipo) {
        case "reserva": return `${a.participante} reservó ${n}`;
        case "comprobante": return `${a.participante} envió un comprobante · ${n} · ${formatearCOP(a.numeros.length * PRECIO_DEMO)}`;
        case "aviso_pago": return `${a.participante} avisa que ya pagó · ${n} · ${formatearCOP(a.numeros.length * PRECIO_DEMO)}`;
        case "solicitud_liberar": return `${a.participante} pide soltar ${n}`;
        case "pago_confirmado": return `Pago confirmado de ${a.participante} · ${n} ${plural ? "quedaron pagados" : "quedó pagado"}`;
        case "pago_rechazado": return `Comprobante de ${a.participante} rechazado · ${n} ${plural ? "siguen pendientes" : "sigue pendiente"}`;
        case "liberado": return `${n} ${plural ? "volvieron a estar disponibles" : "volvió a estar disponible"} (antes de ${a.participante})`;
    }
}

// ---------- Ayudantes internos (no mutan la sesión recibida) ----------

type SinId<T> = T extends unknown ? Omit<T, "id"> : never;

function conMensajes(s: SesionDemo, ...nuevos: Array<SinId<MensajeChat>>): SesionDemo {
    let id = s.siguienteId;
    const agregados = nuevos.map((m) => ({ ...m, id: id++ }) as MensajeChat);
    return { ...s, mensajes: [...s.mensajes, ...agregados], siguienteId: id };
}

function conAviso(s: SesionDemo, aviso: Omit<Aviso, "id">): SesionDemo {
    return { ...s, avisos: [{ ...aviso, id: s.siguienteId }, ...s.avisos], siguienteId: s.siguienteId + 1 };
}

function resolverAvisos(s: SesionDemo, cumple: (a: Aviso) => boolean): SesionDemo {
    return { ...s, avisos: s.avisos.map((a) => (a.estado === "pendiente" && cumple(a) ? { ...a, estado: "resuelto" } : a)) };
}

// Confirma el pago de un participante (sticker o «Aprobar»): TODOS sus
// reservados pasan a pagados y sus avisos de pago quedan resueltos.
function confirmarPago(s: SesionDemo, participante: string): SesionDemo {
    const { tabla, cambiados } = confirmarPagoDe(s.tabla, participante);
    let r = resolverAvisos({ ...s, tabla, resaltados: cambiados }, (a) => a.participante === participante && PAGO.includes(a.tipo));
    if (cambiados.length) r = conAviso(r, { tipo: "pago_confirmado", participante, numeros: cambiados, mensajeId: null, estado: "info" });
    return r;
}

// Libera números y deja un aviso por cada dueño anterior.
function liberar(s: SesionDemo, numeros: number[]): SesionDemo {
    const duenos = new Map<string, number[]>();
    for (const n of numeros) {
        const c = s.tabla[n];
        if (c) duenos.set(c.dueno, [...(duenos.get(c.dueno) ?? []), n]);
    }
    const { tabla, cambiados } = liberarNumeros(s.tabla, numeros);
    let r: SesionDemo = { ...s, tabla, resaltados: cambiados };
    for (const [participante, propios] of duenos) {
        r = conAviso(r, { tipo: "liberado", participante, numeros: propios, mensajeId: null, estado: "info" });
    }
    return r;
}

function citaDe(s: SesionDemo, mensajeId: number | null): { autor: string; texto: string } | null {
    const m = s.mensajes.find((x) => x.id === mensajeId);
    if (!m) return null;
    if (m.clase === "comprobante") return { autor: m.autor, texto: `🧾 Comprobante · ${listaNumeros(m.numeros)}` };
    if (m.clase === "texto") return { autor: m.autor, texto: m.texto };
    return null;
}

// Aviso de pago pendiente más reciente (el que el sticker del organizador
// responde).
export function pagoPendienteMasReciente(s: SesionDemo): Aviso | null {
    return s.avisos.find((a) => a.estado === "pendiente" && PAGO.includes(a.tipo)) ?? null;
}

// ---------- Reducer ----------

export function reducirDemo(s: SesionDemo, accion: AccionDemo): SesionDemo {

    switch (accion.tipo) {

        case "reiniciar":
            return crearSesion();

        case "enviar": {
            const texto = accion.texto.trim().slice(0, 200);
            if (!texto || s.enEspera) return s;
            const mensajeId = s.siguienteId;
            let r = conMensajes(s, { clase: "texto", autor: accion.autor, texto, reaccion: null });
            if (accion.autor === ORGANIZADOR) {
                return conMensajes(r, {
                    clase: "nota",
                    texto: "EFAAT atiende a los participantes. Como organizador, confirma pagos con el sticker de pago o gestiona los números desde el panel."
                });
            }
            r = { ...r, enEspera: { mensajeId, autor: accion.autor, texto } };
            return r;
        }

        case "responder": {
            if (!s.enEspera) return s;
            const { mensajeId, autor, texto } = s.enEspera;
            const res = procesarMensaje(s.tabla, texto, autor);

            let r: SesionDemo = {
                ...s,
                tabla: res.tabla,
                enEspera: null,
                resaltados: res.reservados,
                mensajes: s.mensajes.map((m) => (m.id === mensajeId && m.clase === "texto" ? { ...m, reaccion: res.reaccion } : m))
            };

            if (res.respuesta) r = conMensajes(r, { clase: "bot", texto: res.respuesta });
            if (res.nota) r = conMensajes(r, { clase: "nota", texto: res.nota });

            if (res.reservados.length) {
                r = conAviso(r, { tipo: "reserva", participante: autor, numeros: res.reservados, mensajeId, estado: "info" });
            }

            if (res.tipo === "aviso_pago") {
                if (res.numeros.length) {
                    r = conAviso(r, { tipo: "aviso_pago", participante: autor, numeros: res.numeros, mensajeId, estado: "pendiente" });
                    r = conMensajes(r, { clase: "nota", texto: "EFAAT no responde a «ya pagué»: el organizador lo confirma respondiendo con su sticker de pago o desde el panel." });
                } else {
                    r = conMensajes(r, { clase: "nota", texto: `${autor} no tiene números pendientes de pago en este sorteo.` });
                }
            }

            if (res.tipo === "solicitud_liberar") {
                if (res.numeros.length) {
                    r = conAviso(r, { tipo: "solicitud_liberar", participante: autor, numeros: res.numeros, mensajeId, estado: "pendiente" });
                    r = conMensajes(r, { clase: "nota", texto: "EFAAT no suelta números por mensaje: el organizador recibe el pedido y los libera desde el panel." });
                } else {
                    r = conMensajes(r, { clase: "nota", texto: `${autor} no tiene esos números reservados.` });
                }
            }

            return r;
        }

        case "comprobante": {
            if (accion.autor === ORGANIZADOR || s.enEspera) return s;
            const pendientes = numerosDe(s.tabla, accion.autor).reservados;
            if (!pendientes.length) {
                return conMensajes(s, { clase: "nota", texto: `${accion.autor} no tiene números pendientes de pago: no hay nada que comprobar.` });
            }
            const mensajeId = s.siguienteId;
            const r = conMensajes(s, { clase: "comprobante", autor: accion.autor, numeros: pendientes });
            return conAviso(r, { tipo: "comprobante", participante: accion.autor, numeros: pendientes, mensajeId, estado: "pendiente" });
        }

        case "sticker": {
            if (s.enEspera) return s;
            if (accion.autor !== ORGANIZADOR) {
                const r = conMensajes(s, { clase: "sticker", autor: accion.autor, dePago: false, cita: null });
                return conMensajes(r, { clase: "nota", texto: "Los stickers de los participantes no cambian nada: solo cuenta el sticker de pago del organizador." });
            }
            const objetivo = pagoPendienteMasReciente(s);
            if (!objetivo) {
                const r = conMensajes(s, { clase: "sticker", autor: ORGANIZADOR, dePago: true, cita: null });
                return conMensajes(r, { clase: "nota", texto: "El sticker de pago solo confirma cuando responde al comprobante o al «ya pagué» de un participante." });
            }
            const r = conMensajes(s, { clase: "sticker", autor: ORGANIZADOR, dePago: true, cita: citaDe(s, objetivo.mensajeId) });
            return confirmarPago(r, objetivo.participante);
        }

        case "aprobar": {
            const aviso = s.avisos.find((a) => a.id === accion.avisoId && a.estado === "pendiente");
            return aviso ? confirmarPago(s, aviso.participante) : s;
        }

        case "rechazar": {
            const aviso = s.avisos.find((a) => a.id === accion.avisoId && a.estado === "pendiente");
            if (!aviso) return s;
            const r = resolverAvisos(s, (a) => a.id === aviso.id);
            const siguen = aviso.numeros.filter((n) => s.tabla[n]?.dueno === aviso.participante && s.tabla[n]?.estado === "reservado");
            return conAviso({ ...r, resaltados: [] }, { tipo: "pago_rechazado", participante: aviso.participante, numeros: siguen, mensajeId: null, estado: "info" });
        }

        case "liberar": {
            const r = accion.avisoId !== undefined ? resolverAvisos(s, (a) => a.id === accion.avisoId) : s;
            return liberar(r, accion.numeros);
        }

        case "mantener":
            return resolverAvisos(s, (a) => a.id === accion.avisoId);

        case "pagar": {
            const duenos = new Set(accion.numeros.map((n) => s.tabla[n]?.dueno).filter((d): d is string => !!d));
            const { tabla, cambiados } = marcarPagados(s.tabla, accion.numeros);
            let r: SesionDemo = { ...s, tabla, resaltados: cambiados };
            for (const d of duenos) {
                const suyos = cambiados.filter((n) => tabla[n]?.dueno === d);
                if (suyos.length) r = conAviso(r, { tipo: "pago_confirmado", participante: d, numeros: suyos, mensajeId: null, estado: "info" });
                // Si ya no le queda nada pendiente, su comprobante deja de estar pendiente.
                if (!numerosDe(tabla, d).reservados.length) r = resolverAvisos(r, (a) => a.participante === d && PAGO.includes(a.tipo));
            }
            return r;
        }

    }

}
