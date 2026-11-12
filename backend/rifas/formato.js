// ==========================================================================
// rifas/formato.js — conversión de números y filas del motor de rifas.
//
// En el motor (migración 050) el número es un ENTERO 0..cantidad-1 y se
// muestra con ceros a la izquierda según las cifras de la rifa ("07", "007").
// El bot y el panel trabajan con texto: aquí está la única conversión.
//
// filaLegado(): la fila de numeros_rifa con la forma que el bot y el panel
// ya conocen de las cuadrículas antiguas (numero texto, nombre, fecha y hora
// de reserva/pago en hora de Colombia). Así cada consumidor cambia la FUENTE
// (tabla_id) sin reescribir cómo pinta o responde.
// ==========================================================================

const { fechaColombia, horaColombia } = require("../shared/tiempo/colombia");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esUuid = (v) => typeof v === "string" && UUID.test(v);

// "07" con 2 cifras, "007" con 3.
function aTexto(numero, cifras) {
    return String(numero).padStart(Math.max(1, Number(cifras) || 1), "0");
}

// Texto o número -> entero válido para la rifa, o null.
//   - solo dígitos (los ceros a la izquierda se aceptan: "07" = 7);
//   - no más dígitos que las cifras de la rifa (si se dan);
//   - dentro de 0..cantidad-1 (si se da la cantidad).
function aEntero(valor, { cifras = null, cantidad = null } = {}) {
    const texto = typeof valor === "number" ? String(valor) : String(valor ?? "").trim();
    if (!/^\d{1,4}$/.test(texto)) return null;
    if (cifras && texto.length > cifras) return null;
    const n = Number(texto);
    if (cantidad != null && (n < 0 || n >= cantidad)) return null;
    return n;
}

// Varios números (texto o enteros). Devuelve los válidos (sin repetidos,
// ordenados) y los inválidos tal como llegaron, para poder informarlos.
function aEnteros(valores, opciones = {}) {
    const validos = new Set();
    const invalidos = [];
    for (const v of valores || []) {
        const n = aEntero(v, opciones);
        if (n === null) invalidos.push(v);
        else validos.add(n);
    }
    return { numeros: [...validos].sort((a, b) => a - b), invalidos };
}

const fecha = (iso) => (iso ? fechaColombia(new Date(iso)) : null);
const hora = (iso) => (iso ? horaColombia(new Date(iso)) : null);

// Fila de numeros_rifa -> forma de las cuadrículas antiguas (+ tabla_id).
function filaLegado(fila, rifa) {
    if (!fila) return null;
    const cifras = rifa?.cifras ?? 2;
    return {
        id: fila.id,
        tabla_id: fila.tabla_id,
        usuario_id: fila.usuario_id,
        numero: aTexto(fila.numero, cifras),
        numero_entero: fila.numero,
        estado: fila.estado,
        comprador: fila.comprador ?? null,
        nombre: fila.comprador ?? null,
        contacto: fila.contacto ?? null,
        telefono: fila.telefono ?? null,
        lid: fila.lid ?? null,
        lib: fila.lib ?? null,
        usuario_global_id: fila.usuario_global_id ?? null,
        grupo_id: fila.grupo_id ?? null,
        grupo_nombre: fila.grupo_nombre ?? null,
        evento_id: fila.evento_id ?? null,
        identidad_evento_real: fila.identidad_evento_real ?? null,
        nombre_evento: fila.nombre_evento ?? null,
        telefono_bot: fila.telefono_bot ?? null,
        rifa_nombre: rifa?.nombre ?? null,
        origen: fila.origen ?? null,
        ciclo: fila.ciclo ?? null,
        fecha_reserva: fecha(fila.reservado_en),
        hora_reserva: hora(fila.reservado_en),
        fecha_pago: fecha(fila.pagado_en),
        hora_pago: hora(fila.pagado_en),
        reservado_en: fila.reservado_en ?? null,
        pagado_en: fila.pagado_en ?? null,
        bloqueado_hasta: fila.bloqueado_hasta ?? null,
        temporal_por: fila.temporal_por ?? null,
        observaciones: fila.observaciones ?? null,
        version: fila.version ?? 0,
        creado_en: fila.actualizado_en ?? null
    };
}

// Resultado de una operación rifa_* con los números en texto (para mostrar
// o responder en WhatsApp con el mismo formato de la rifa).
function resultadoEnTexto(resultado, cifras) {
    if (!resultado || typeof resultado !== "object") return resultado;
    const salida = { ...resultado };
    for (const clave of ["reservados", "no_disponibles", "fuera_de_rango", "pagados", "ya_pagados", "no_pagables", "liberados", "no_liberados", "bloqueados"]) {
        if (Array.isArray(salida[clave])) salida[clave] = salida[clave].map(n => aTexto(n, cifras));
    }
    return salida;
}

module.exports = { esUuid, aTexto, aEntero, aEnteros, filaLegado, resultadoEnTexto };
