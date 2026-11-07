// ==========================================================================
// shared/mensajes/orquestador.js — ORQUESTADOR CENTRAL DE MENSAJES (O1).
//
// Coordina el ciclo de vida de un mensaje que un motor YA decidió enviar:
//   1 solicitud · 2 cliente y contexto · 3 tipo · 4 selección · 5 variables ·
//   6 formato · 7 validación · 8 destino y canal · 9 envío único + envío ·
//   10 registro.
//
// AISLADO (O1): no importa nada de bot/, automation/, sorteos/ ni
// services/. Todo lo que toca el exterior se INYECTA:
//   adaptadores  { [origen]: adaptador }   (ver CONTRATO DEL ADAPTADOR)
//   envios       { sendMessage, sendImage, sendReaction }  (firma de send.js)
//   guardian     { ejecutarUnaVez }        (firma de executionGuard)
//   registro     { registrar(entrada) }
//   modo         (origen) => "off" | "shadow" | "active"  (por defecto: variables de entorno)
//   aleatorio    () => [0,1)                (por defecto Math.random)
// En O1 ningún motor lo llama todavía.
//
// MODO SOMBRA — garantías (probadas en tests/mensajes-o1):
//   no envía · no llama al guardián (no consume claves) · no llama a
//   antesDeEnviar/despuesDeEnviar (no avanza rotaciones ni registra usos) ·
//   pide a los adaptadores solo lecturas y les pasa { modo: "shadow" } para
//   que el respaldo con IA no se ejecute.
//
// CONTRATO DEL ADAPTADOR (todas opcionales salvo renderizar en tipos con
// plantillas; todas pueden ser async):
//   habilitado(solicitud, tipo)                 -> boolean (interruptor)
//   candidatas(solicitud, tipo)                 -> plantillas [{ id, contenido, usuario_id? … }]  SOLO LECTURA
//   filtrar(candidatas, solicitud, tipo)        -> candidatas (reglas propias: agotado, sin precio…)
//   preferencias(solicitud, tipo)               -> { modo_seleccion, plantilla_fija_id, rotacion_indice, ultimoUsadoId }  SOLO LECTURA
//   variables(solicitud, plantilla, tipo)       -> objeto de valores reales
//   renderizar(contenido, variables, solicitud, plantilla) -> { texto, faltantes? } | string | null
//   validar(texto, solicitud, info)             -> { ok, motivo? }
//   respaldo(solicitud, { motivo, modo, tipo }) -> { texto, fuente } | null   (en shadow NUNCA llamar a la IA)
//   antesDeEnviar(solicitud, info)              -> efectos previos al envío (solo active)
//   despuesDeEnviar(solicitud, info)            -> efectos tras un envío correcto (solo active)
//   bloquearSiFaltan                            -> boolean (automatización: variable faltante = no enviar)
//   maxLongitud                                 -> número | null
// ==========================================================================

"use strict";

const { obtenerTipo, tipoEfectivo, ORIGENES } = require("./catalogoTipos");
const { MODOS, resolverModo } = require("./modos");
const { seleccionar } = require("./etapas/seleccion");
const { validarContenido, validarSolicitud } = require("./etapas/validacion");
const { ejecutarConClave } = require("./etapas/envioUnico");
const { construirEntrada, registroNulo } = require("./etapas/registro");
const { validarSalida, enviarPorCanal } = require("./canales");

// SOLICITUD
// {
//   origen, tipo, usuarioId,
//   sesion: { sock },                  sock.context.usuarioId debe ser el mismo cliente
//   destino: { jid, citar? },
//   contexto: { … },                   resultado real ya calculado por el motor
//   textoAprobado?,                    seleccion "copia": texto guardado (sorteos/anuncio)
//   texto?,                            seleccion "ninguna": texto fijo del sistema
//   textoRespaldo?,                    mensaje fijo del motor (respaldo por defecto)
//   anexo?,                            se añade tras el texto de una PLANTILLA ("\n\n")
//   imagen?, reaccion?: { key, emoji },
//   claveEnvioUnico?, tipoAccion?, eventSessionId?,
//   aleatorio?                         azar de ESTA solicitud (sombra = mismo azar que el motor)
// }
//
// RESULTADO (nunca lanza)
// { estado: "apagado"|"sombra"|"enviado"|"omitido"|"duplicado"|"error",
//   motivo?, fuente?: "plantilla"|"copia"|"fijo"|"ia", plantillaId?, texto?,
//   canal?, candidatas?: [ids], efectos?, mensajeId?, error? }

function normalizarRender(salida) {
    if (salida == null) return { texto: null, faltantes: [] };
    if (typeof salida === "string") return { texto: salida, faltantes: [] };
    return { texto: salida.texto ?? null, faltantes: Array.isArray(salida.faltantes) ? salida.faltantes : [] };
}

function crearOrquestador({
    adaptadores = {},
    envios = null,
    guardian = null,
    registro = registroNulo,
    modo = (origen) => resolverModo(origen),
    aleatorio = Math.random,
    reloj = () => Date.now()
} = {}) {

    for (const origen of Object.keys(adaptadores)) {
        if (!ORIGENES.includes(origen)) throw new Error(`Adaptador para un origen desconocido: ${origen}`);
    }

    function terminar(solicitud, modoActual, inicio, resultado) {
        const final = Object.freeze({ ...resultado });
        if (modoActual !== MODOS.OFF) {
            try { registro.registrar(construirEntrada({ solicitud, modo: modoActual, resultado: final, inicio, ahora: reloj() })); } catch { /* el registro nunca corta el flujo */ }
        }
        return final;
    }

    // Etapas 1–8: decide QUÉ se enviaría. Sin efectos en ningún modo.
    async function decidir(solicitud, tipo, adaptador, modoActual) {

        const tipoReal = tipoEfectivo(tipo.id);
        const canal = solicitud.canal || tipo.canal;

        // 3b. Interruptor del tipo.
        if (adaptador.habilitado && (await adaptador.habilitado(solicitud, tipoReal)) === false) {
            return { estado: "omitido", motivo: "interruptor_apagado", canal };
        }

        let texto = null;
        let fuente = null;
        let plantilla = null;
        let efectos = {};
        let candidatasIds;
        let fallo = null;

        if (tipo.seleccion === "ninguna") {
            texto = solicitud.texto ?? null;
            fuente = "fijo";
        } else if (tipo.seleccion === "copia") {
            const contenido = solicitud.textoAprobado ?? "";
            const vars = adaptador.variables ? await adaptador.variables(solicitud, null, tipoReal) : {};
            const r = adaptador.renderizar ? normalizarRender(await adaptador.renderizar(contenido, vars, solicitud, null)) : { texto: contenido, faltantes: [] };
            texto = r.texto ?? "";
            fuente = "copia";
        } else {
            // 4. Candidatas (solo lectura) + defensa de aislamiento.
            const leidas = adaptador.candidatas ? (await adaptador.candidatas(solicitud, tipoReal)) || [] : [];
            const propias = leidas.filter(p => p?.usuario_id == null || p.usuario_id === solicitud.usuarioId);
            const filtradas = adaptador.filtrar ? (await adaptador.filtrar(propias, solicitud, tipoReal)) || [] : propias;
            candidatasIds = filtradas.map(p => p.id);
            const preferencias = adaptador.preferencias ? await adaptador.preferencias(solicitud, tipoReal) : null;
            const sel = seleccionar(tipo.seleccion, filtradas, preferencias, solicitud.aleatorio || aleatorio);
            plantilla = sel.plantilla;
            efectos = sel.efectos;

            if (!plantilla) {
                fallo = filtradas.length ? "sin_seleccion" : "sin_plantillas";
            } else {
                // 5–6. Variables y formato propios del motor.
                const vars = adaptador.variables ? await adaptador.variables(solicitud, plantilla, tipoReal) : {};
                const r = normalizarRender(await adaptador.renderizar(plantilla.contenido, vars, solicitud, plantilla));
                // 7. Validación genérica + la del motor.
                const v = validarContenido({ texto: r.texto, canal, faltantes: r.faltantes, bloquearSiFaltan: !!adaptador.bloquearSiFaltan, maxLongitud: adaptador.maxLongitud ?? null });
                const extra = v.ok && adaptador.validar ? await adaptador.validar(r.texto, solicitud, { plantilla, faltantes: r.faltantes }) : { ok: true };
                if (!v.ok || extra?.ok === false) {
                    fallo = !v.ok ? v.motivo : (extra.motivo || "validacion_adaptador");
                    if (v.motivo === "variable_faltante") efectos = { ...efectos, faltantes: v.detalle };
                } else {
                    texto = r.texto;
                    fuente = "plantilla";
                    if (solicitud.anexo) texto = `${texto}\n\n${solicitud.anexo}`;
                }
            }
        }

        // Respaldo según el tipo.
        if (fallo) {
            const base = { canal, candidatas: candidatasIds, efectos: {} };
            if (tipo.respaldo === "no_enviar" || tipo.respaldo === "ninguno") {
                return { ...base, estado: "omitido", motivo: fallo, ...(efectos.faltantes ? { faltantes: efectos.faltantes } : {}) };
            }
            const r = adaptador.respaldo
                ? await adaptador.respaldo(solicitud, { motivo: fallo, modo: modoActual, tipo: tipoReal })
                : (solicitud.textoRespaldo ? { texto: solicitud.textoRespaldo, fuente: "fijo" } : null);
            if (!r || typeof r.texto !== "string" || !r.texto) {
                return { ...base, estado: "omitido", motivo: r?.fuente === "ia" && modoActual === MODOS.SHADOW ? "ia_no_ejecutada_en_sombra" : "sin_respaldo" };
            }
            texto = r.texto;
            fuente = r.fuente || "fijo";
            plantilla = null;
            efectos = {};
        }

        // 8. Destino y canal.
        // En sombra la imagen no se genera (es cara y no se va a enviar): solo
        // se decide el texto.
        const salida = canal === "imagen" && modoActual === MODOS.SHADOW
            ? { ok: true }
            : validarSalida(canal, { texto, imagen: solicitud.imagen, reaccion: solicitud.reaccion });
        if (!salida.ok) {
            return { estado: "omitido", motivo: salida.motivo, canal, candidatas: candidatasIds };
        }

        return { estado: "listo", canal, texto, fuente, plantilla, plantillaId: plantilla?.id || null, efectos, candidatas: candidatasIds };
    }

    async function procesar(solicitud, opciones = {}) {

        const inicio = reloj();
        const errores = validarSolicitud(solicitud);
        const tipo = obtenerTipo(solicitud?.tipo);
        const modoActual = opciones.modo || (tipo ? modo(tipo.origen) : MODOS.OFF);

        if (modoActual === MODOS.OFF) return Object.freeze({ estado: "apagado" });
        if (errores.length) return terminar(solicitud, modoActual, inicio, { estado: "error", motivo: errores[0], errores });
        if (!tipo.soportado) return terminar(solicitud, modoActual, inicio, { estado: "omitido", motivo: "tipo_no_soportado" });

        const adaptador = adaptadores[tipo.origen];
        if (!adaptador) return terminar(solicitud, modoActual, inicio, { estado: "error", motivo: "sin_adaptador" });

        // 2. Cliente: la sesión debe ser de ESE cliente (nunca el WhatsApp de otro).
        const sock = solicitud.sesion?.sock || null;
        const duenoSesion = sock?.context?.usuarioId;
        if (duenoSesion && duenoSesion !== solicitud.usuarioId) {
            return terminar(solicitud, modoActual, inicio, { estado: "error", motivo: "sesion_de_otro_cliente" });
        }
        if (modoActual === MODOS.ACTIVE && !sock) return terminar(solicitud, modoActual, inicio, { estado: "error", motivo: "sin_sesion" });

        let decision;
        try {
            decision = await decidir(solicitud, tipo, adaptador, modoActual);
        } catch (err) {
            return terminar(solicitud, modoActual, inicio, { estado: "error", motivo: "excepcion_decision", error: err?.message || String(err) });
        }

        const { plantilla, ...publico } = decision;

        if (decision.estado !== "listo") return terminar(solicitud, modoActual, inicio, publico);

        // SOMBRA: aquí se detiene. Nada de guardián, envío ni efectos.
        if (modoActual === MODOS.SHADOW) return terminar(solicitud, modoActual, inicio, { ...publico, estado: "sombra" });

        // 9. ACTIVO.
        if (!envios) return terminar(solicitud, modoActual, inicio, { ...publico, estado: "error", motivo: "sin_envios" });

        const info = { plantilla, efectos: decision.efectos, texto: decision.texto, fuente: decision.fuente };
        const enviar = async () => {
            const r = await enviarPorCanal({
                envios, canal: decision.canal, sock, jid: solicitud.destino.jid,
                texto: decision.texto, citar: solicitud.destino.citar, imagen: solicitud.imagen, reaccion: solicitud.reaccion
            });
            if (adaptador.despuesDeEnviar) await adaptador.despuesDeEnviar(solicitud, { ...info, resultadoEnvio: r });
            return { mensajeId: r?.key?.id || null };
        };

        try {
            if (adaptador.antesDeEnviar) await adaptador.antesDeEnviar(solicitud, info);

            if (tipo.envioUnico === "obligatorio") {
                if (!solicitud.claveEnvioUnico) return terminar(solicitud, modoActual, inicio, { ...publico, estado: "error", motivo: "sin_clave" });
                if (!guardian) return terminar(solicitud, modoActual, inicio, { ...publico, estado: "error", motivo: "sin_guardian" });
                const r = await ejecutarConClave({
                    guardian, clave: solicitud.claveEnvioUnico, tipoAccion: solicitud.tipoAccion || tipo.id,
                    usuarioId: solicitud.usuarioId, grupoId: solicitud.destino.jid, eventSessionId: solicitud.eventSessionId, enviar
                });
                const { resultado, ...estadoEnvio } = r;
                return terminar(solicitud, modoActual, inicio, { ...publico, ...estadoEnvio, mensajeId: resultado?.mensajeId || null });
            }

            const r = await enviar();
            return terminar(solicitud, modoActual, inicio, { ...publico, estado: "enviado", mensajeId: r.mensajeId });
        } catch (err) {
            return terminar(solicitud, modoActual, inicio, { ...publico, estado: "error", motivo: "fallo_envio", error: err?.message || String(err) });
        }
    }

    return { procesar };
}

// Compara la decisión en SOMBRA con lo que hizo el motor actual.
// legado: { enviado: boolean, texto?, plantillaId?, fuente? }
// -> { coincide, diferencias: [{ campo, orquestador, actual }] }
function comparar(resultadoSombra, legado) {
    const diferencias = [];
    const enviariaOrq = resultadoSombra?.estado === "sombra";
    const enviaLegado = !!legado?.enviado;
    if (enviariaOrq !== enviaLegado) diferencias.push({ campo: "envio", orquestador: enviariaOrq, actual: enviaLegado });
    if (enviariaOrq && enviaLegado) {
        if ((resultadoSombra.texto ?? null) !== (legado.texto ?? null)) diferencias.push({ campo: "texto", orquestador: resultadoSombra.texto, actual: legado.texto });
        if (legado.plantillaId !== undefined && (resultadoSombra.plantillaId ?? null) !== (legado.plantillaId ?? null)) {
            diferencias.push({ campo: "plantillaId", orquestador: resultadoSombra.plantillaId, actual: legado.plantillaId });
        }
        if (legado.fuente !== undefined && resultadoSombra.fuente !== legado.fuente) diferencias.push({ campo: "fuente", orquestador: resultadoSombra.fuente, actual: legado.fuente });
    }
    return { coincide: diferencias.length === 0, diferencias };
}

module.exports = { crearOrquestador, comparar };
