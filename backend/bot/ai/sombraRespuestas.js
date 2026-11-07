// ==========================================================================
// bot/ai/sombraRespuestas.js — FASE O4: RESPUESTAS A RESERVAS Y CONSULTAS en
// MODO SOMBRA.
//
// responderResultado.js sigue siendo el ÚNICO que responde. Después de su
// envío (o de su silencio por interruptor apagado) llama aquí y el
// orquestador central decide por su cuenta qué habría respondido. Se
// comparan: banderas de la decisión, candidatas, rotación, variables,
// plantilla, texto final, origen del texto (plantilla / fijo / IA) y resultado.
//
// Dos adaptadores (reglas distintas):
//   RESERVAS   sin IA nunca; sin filtros de plantillas; respaldo = mensaje fijo.
//   CONSULTAS  filtros de agotado ({{numeros_disponibles}}) y de montos sin
//              precio; IA solo donde el motor la permite (p. ej. info_evento);
//              consultas de números/pago, disponibilidad y estado de un número
//              nunca usan IA.
//
// Lo que la sombra NO hace: enviar (sin `envios` ni guardián), llamar a la IA
// (en sombra el respaldo con IA devuelve «no ejecutada» y el texto no se
// compara), avanzar la rotación (usa la configuración tal como la leyó el
// motor ANTES de avanzarla), escribir nada. Nunca lanza.
//
// Solo actúa con MENSAJES_ORQUESTADOR_RESPUESTA = shadow (o active, que en
// O4 es SOLO sombra).
// ==========================================================================

"use strict";

const { crearOrquestador, comparar } = require("../../shared/mensajes");
const { resolverModo, MODOS } = require("../../shared/mensajes/modos");
const { huella } = require("../../shared/mensajes/etapas/registro");

const ORIGEN = "respuesta";

// Mismas banderas que calcula responderResultado.js (recalculadas aquí de
// forma independiente y comparadas con las del motor).
function calcularBanderas(ctx, resultado, tipoPresentacion) {
    const { TIPOS_SIN_IA, TIPOS_ESTADO_NUMEROS } = require("./responderResultado");
    const esAgotado = resultado.agotado === true;
    const esConsultaDeEstado = !ctx.reserva && TIPOS_SIN_IA.has(resultado.tipo);
    const esErrorTecnico = resultado.errorTecnico === true;
    const soloMensajeFijo = resultado.soloMensajeFijo === true;
    const sinIA = Boolean(ctx.reserva) || TIPOS_ESTADO_NUMEROS.has(resultado.tipo);
    const esPreguntaPuntualDePago = resultado.tipo === "consulta_pago" && resultado.modo !== "resumen";
    const puedeUsarPlantillas = (!esAgotado || tipoPresentacion === "disponibilidad_agotada") && !esPreguntaPuntualDePago && !esErrorTecnico && !soloMensajeFijo && Boolean(tipoPresentacion);
    const iaPermitida = !esAgotado && !esConsultaDeEstado && !esErrorTecnico && !sinIA;
    return { esAgotado, esConsultaDeEstado, esErrorTecnico, soloMensajeFijo, sinIA, esPreguntaPuntualDePago, puedeUsarPlantillas, iaPermitida };
}

// Partes comunes a los dos adaptadores (solo LECTURA).
function adaptadorBase() {
    return {
        habilitado: async (s) => {
            const { tipoPresentacion } = s.contexto;
            if (!tipoPresentacion) return true;
            const { estaRespuestaHabilitada } = require("./configMensajes");
            return estaRespuestaHabilitada(s.usuarioId, tipoPresentacion);
        },
        candidatas: async (s) => {
            const { tipoPresentacion, banderas } = s.contexto;
            if (!banderas.puedeUsarPlantillas) return [];
            const { obtenerPlantillasHabilitadas } = require("./configMensajes");
            const filas = await obtenerPlantillasHabilitadas(tipoPresentacion, s.usuarioId);
            return (filas || []).map(p => ({ ...p, usuario_id: p.usuario_id ?? s.usuarioId }));
        },
        // La configuración TAL COMO LA LEYÓ EL MOTOR (antes de avanzar la rotación).
        preferencias: async (s) => s.contexto.configMotor,
        variables: async (s) => {
            const { construirVariables } = require("./plantillaMensaje");
            return construirVariables(s.contexto.ctx, s.contexto.resultado, s.contexto.catalogoExtra);
        },
        renderizar: (contenido, variables, s, plantilla) => {
            const { aplicarPlantilla } = require("./plantillaMensaje");
            return aplicarPlantilla(contenido, variables, plantilla?.variables || {}, s.contexto.catalogoExtra);
        }
    };
}

function crearAdaptadorReservas() {
    return {
        ...adaptadorBase(),
        respaldo: async (s) => ({ texto: s.contexto.resultado.mensaje, fuente: "fijo" })
    };
}

function crearAdaptadorConsultas() {
    return {
        ...adaptadorBase(),
        filtrar: async (candidatas, s) => {
            const { usaListaDeDisponibles, usaMontos } = require("./responderResultado");
            const { banderas, ctx } = s.contexto;
            let lista = candidatas;
            if (banderas.esAgotado) lista = lista.filter(p => !usaListaDeDisponibles(p?.contenido));
            if (banderas.esConsultaDeEstado && !(Number(ctx.evento?.valor) > 0)) lista = lista.filter(p => !usaMontos(p?.contenido));
            return lista;
        },
        respaldo: async (s, { modo }) => {
            if (s.contexto.banderas.iaPermitida) {
                // En sombra la IA NUNCA se ejecuta: el texto no es comparable.
                return modo === MODOS.SHADOW ? { fuente: "ia", texto: null } : null;
            }
            return { texto: s.contexto.resultado.mensaje, fuente: "fijo" };
        }
    };
}

// Un solo origen («respuesta») con dos familias de reglas.
function crearAdaptadorRespuestas() {
    const reservas = crearAdaptadorReservas();
    const consultas = crearAdaptadorConsultas();
    const de = (s) => (s.contexto.familia === "reserva" ? reservas : consultas);
    const adaptador = {};
    for (const clave of ["habilitado", "candidatas", "filtrar", "preferencias", "variables", "renderizar", "respaldo"]) {
        adaptador[clave] = (...args) => {
            const s = clave === "filtrar" ? args[1] : clave === "renderizar" ? args[2] : args[0];
            const fn = de(s)[clave];
            return fn ? fn(...args) : (clave === "filtrar" ? args[0] : undefined);
        };
    }
    return adaptador;
}

// -------------------------------------------------------------- utilidades

function huellaVariables(variables) {
    if (!variables || typeof variables !== "object") return null;
    return huella(JSON.stringify(Object.keys(variables).sort().map(k => [k, variables[k] == null ? null : String(variables[k])])));
}

// Vista previa sin datos personales: el nombre del cliente se sustituye y
// las secuencias largas de dígitos (teléfonos, cuentas) se tapan.
function vistaPreviaSegura(texto, nombreCliente, max = 120) {
    if (typeof texto !== "string") return null;
    let t = texto;
    if (nombreCliente && String(nombreCliente).trim().length >= 2) t = t.split(String(nombreCliente)).join("‹cliente›");
    t = t.replace(/\d[\d\s.\-]{5,}\d/g, "•••");
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

const ordenados = (ids) => JSON.stringify([...(ids || [])].sort());
const CLAVES_BANDERAS = ["esAgotado", "esConsultaDeEstado", "esErrorTecnico", "soloMensajeFijo", "sinIA", "esPreguntaPuntualDePago", "puedeUsarPlantillas"];

// datos: { ctx, resultado, tipoPresentacion, foto, actual }
async function compararRespuestaEnSombra({ ctx, resultado, tipoPresentacion, foto = {}, actual, entorno = process.env, log = console.log } = {}) {

    try {
        const modoConfigurado = resolverModo(ORIGEN, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const usuarioId = ctx?.session?.usuarioId || null;
        const familia = ctx?.reserva ? "reserva" : "consulta";
        const nombre = ctx?.usuario?.nombre || null;
        const base = {
            origen: ORIGEN, familia, tipo: tipoPresentacion || "respuesta_fija", tipoResultado: resultado?.tipo || null,
            modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O4: solo sombra" } : {}),
            usuarioId, destino: huella(ctx?.chat?.remoteJid), citado: Boolean(ctx?.message?.key?.id)
        };

        // Sin cliente de sesión el motor no consulta interruptores ni
        // plantillas: no hay nada que el orquestador pueda decidir igual.
        if (!usuarioId) {
            const entrada = { ...base, coincide: null, motivo: "no_comparable:sin_usuario_de_sesion" };
            log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
            return entrada;
        }

        const banderas = calcularBanderas(ctx, resultado, tipoPresentacion);

        // Variables dinámicas del cliente (solo lectura), como el motor.
        let catalogoExtra = [];
        if (banderas.puedeUsarPlantillas) {
            const { obtenerVariablesActivas } = require("../../shared/variables/variablesGlobalesRepo");
            const { normalizarVariableDinamica } = require("../../shared/variables/catalogoVariables");
            catalogoExtra = ((await obtenerVariablesActivas(usuarioId)) || []).map(normalizarVariableDinamica).filter(Boolean);
        }

        const orquestador = crearOrquestador({
            adaptadores: { [ORIGEN]: crearAdaptadorRespuestas() },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios` ni `guardian`: imposible enviar o consumir claves.
        });

        const resultadoOrq = await orquestador.procesar({
            origen: ORIGEN,
            tipo: tipoPresentacion || "respuesta_fija",
            usuarioId,
            sesion: { sock: ctx.sock },
            destino: { jid: ctx.chat?.remoteJid, citar: ctx.message },
            texto: resultado.mensaje,
            anexo: resultado.textoAdicional || "",
            contexto: { ctx, resultado, tipoPresentacion, banderas, familia, catalogoExtra, configMotor: foto.config ?? null },
            aleatorio: () => (typeof foto.azar === "number" ? foto.azar : 0)
        }, { modo: MODOS.SHADOW });

        // Comprobación de la rotación guardada por el motor (lectura propia).
        let rotacionGuardada = null;
        if (foto.nuevoIndiceRotacion != null) {
            const { obtenerConfigSeleccion } = require("./configMensajes");
            const leida = await obtenerConfigSeleccion(tipoPresentacion, usuarioId);
            rotacionGuardada = leida?.rotacion_indice === foto.nuevoIndiceRotacion;
        }

        // ¿Qué se pudo comparar?
        const viaIa = actual?.fuente === "ia" || (actual?.iaIntentada && actual?.fuente === "fijo");
        const orqViaIa = resultadoOrq.motivo === "ia_no_ejecutada_en_sombra";
        const banderasDistintas = foto.banderas ? CLAVES_BANDERAS.filter(k => foto.banderas[k] !== banderas[k]) : [];
        const candidatasComparables = foto.habilitada !== false && banderas.puedeUsarPlantillas && Array.isArray(foto.habilitadasIds);
        const candidatasCoinciden = candidatasComparables ? ordenados(foto.habilitadasIds) === ordenados(resultadoOrq.candidatas) : null;
        const ambasPlantilla = actual?.fuente === "plantilla" && resultadoOrq.fuente === "plantilla";
        const rotacionCoincide = ambasPlantilla ? (foto.nuevoIndiceRotacion ?? null) === (resultadoOrq.efectos?.nuevoIndiceRotacion ?? null) : null;
        let variablesCoinciden = null;
        if (ambasPlantilla && foto.variables) {
            const { construirVariables } = require("./plantillaMensaje");
            variablesCoinciden = huellaVariables(foto.variables) === huellaVariables(construirVariables(ctx, resultado, catalogoExtra));
        }

        let cmp = { coincide: true, diferencias: [] };
        let motivo = null;
        if (banderasDistintas.length) motivo = `banderas_distintas:${banderasDistintas.join(",")}`;
        else if (resultadoOrq.estado === "error") motivo = `error_orquestador:${resultadoOrq.motivo}`;
        else if (candidatasCoinciden === false) motivo = "candidatas_distintas";
        else if (rotacionCoincide === false) motivo = "rotacion_distinta";
        else if (variablesCoinciden === false) motivo = "variables_distintas";
        else if (viaIa || orqViaIa) {
            if (viaIa !== orqViaIa) motivo = "ruta_distinta";
        } else {
            cmp = comparar(resultadoOrq, { enviado: actual?.enviado, texto: actual?.texto, plantillaId: actual?.plantillaId ?? null, fuente: actual?.fuente });
            const campos = cmp.diferencias.map(d => d.campo);
            if (campos.includes("envio")) motivo = resultadoOrq.motivo ? `envio_distinto:${resultadoOrq.motivo}` : "envio_distinto";
            else if (campos.includes("plantillaId")) motivo = "plantilla_distinta";
            else if (campos.includes("texto")) motivo = "texto_distinto";
            else if (campos.includes("fuente")) motivo = "fuente_distinta";
        }
        if (motivo === null && rotacionGuardada === false) motivo = "rotacion_guardada_distinta";

        const entrada = {
            ...base,
            banderas: { iguales: banderasDistintas.length === 0, iaPermitida: banderas.iaPermitida, puedeUsarPlantillas: banderas.puedeUsarPlantillas },
            seleccion: {
                modo: foto.config?.modo_seleccion ?? null,
                candidatasActuales: foto.habilitadasIds ?? null,
                candidatasOrquestador: resultadoOrq.candidatas ?? null,
                azar: foto.azar ?? null,
                rotacionActual: foto.nuevoIndiceRotacion ?? null,
                rotacionOrquestador: resultadoOrq.efectos?.nuevoIndiceRotacion ?? null,
                rotacionGuardada
            },
            variables: { coinciden: variablesCoinciden, huellaActual: huellaVariables(foto.variables) },
            actual: {
                estado: actual?.estado || null,
                fuente: actual?.fuente || null,
                iaIntentada: Boolean(actual?.iaIntentada),
                plantillaId: actual?.plantillaId ?? null,
                huellaTexto: huella(actual?.texto),
                longitud: typeof actual?.texto === "string" ? actual.texto.length : null,
                vistaPrevia: vistaPreviaSegura(actual?.texto, nombre)
            },
            orquestador: {
                estado: resultadoOrq.estado,
                motivo: resultadoOrq.motivo || null,
                fuente: resultadoOrq.fuente || (orqViaIa ? "ia" : null),
                plantillaId: resultadoOrq.plantillaId ?? null,
                huellaTexto: huella(resultadoOrq.texto),
                longitud: typeof resultadoOrq.texto === "string" ? resultadoOrq.texto.length : null,
                vistaPrevia: vistaPreviaSegura(resultadoOrq.texto, nombre)
            },
            textoComparable: !(viaIa || orqViaIa),
            coincide: motivo === null,
            diferencias: cmp.diferencias.map(d => d.campo),
            motivo
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen: ORIGEN, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = {
    compararRespuestaEnSombra,
    crearAdaptadorRespuestas,
    crearAdaptadorReservas,
    crearAdaptadorConsultas,
    calcularBanderas,
    vistaPreviaSegura
};
