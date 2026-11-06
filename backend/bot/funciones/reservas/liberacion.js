// ==========================================================================
// liberacion.js: FUENTE ÚNICA de lo que significa LIBERAR un número de la
// cuadrícula (F1-B, 06/11/2026).
//
// Lo usan todos los caminos del backend que liberan:
//   - services/reservaManual.js  liberarManual y liberarLote (panel);
//   - sorteos/publicador.js      liberarVencidas (vencimiento automático).
//
// Antes había dos copias de la lista de campos y la del vencimiento no
// limpiaba telefono_bot ni ip_reserva (caracterización C5): un número
// vencido quedaba «libre» con restos del reservante anterior. Ahora todos
// dejan el número EXACTAMENTE igual que el reinicio seguro (migración 030,
// reiniciar_tabla_cliente) y que frontend/services/tablas/reiniciarTabla.ts;
// tests/reservas/liberacion.test.js comprueba que las tres listas coinciden.
//
// Qué se pierde al limpiar y dónde queda:
//   - comprador, contacto, grupo, evento, identidad: en reservas_auditoria
//     (032) y reservas_actividad, que cada liberación escribe ANTES de
//     terminar (ver contextoAuditoriaFila en auditoriaReservas.js).
//   - telefono_bot: es el número de WhatsApp de la sesión del NEGOCIO, copia
//     literal de eventos_bot.telefono_bot (reservarNumeros.js); se recupera
//     con el evento_id que guardan los dos registros.
//   - ip_reserva: ningún código de EFAAT la ha escrito nunca (siempre null).
//
// Las condiciones de CADA camino (qué números, qué estado esperado, qué
// identidad) las pone el llamador sobre la consulta que devuelve
// consultaLiberacion: este módulo fija QUÉ se escribe y que solo se toca la
// cuadrícula del cliente, nunca cuándo procede liberar.
// ==========================================================================

"use strict";

const { soloDelCliente } = require("./filtroCliente");

const CAMPOS_LIBERACION = Object.freeze({
    estado: "libre",
    comprador: null, contacto: null, contacto_lower: null, nombre: null, telefono: null, lib: null,
    grupo_id: null, grupo_nombre: null, evento_id: null, nombre_evento: null, telefono_bot: null,
    fecha_reserva: null, hora_reserva: null, fecha_pago: null, hora_pago: null,
    temporal_por: null, bloqueado_hasta: null, ip_reserva: null, usuario_global_id: null
});

// UPDATE de liberación sobre la cuadrícula del cliente. El llamador añade
// SIEMPRE la condición del estado que leyó (.eq("estado", …)) para no pisar
// un cambio concurrente, y los números/identidad que correspondan.
// Sin usuarioId no se toca nada (soloDelCliente devuelve un error).
function consultaLiberacion(supabase, { usuarioId, tabla }) {
    return soloDelCliente(supabase.from(tabla).update({ ...CAMPOS_LIBERACION }), { usuario_id: usuarioId });
}

module.exports = { CAMPOS_LIBERACION, consultaLiberacion };
