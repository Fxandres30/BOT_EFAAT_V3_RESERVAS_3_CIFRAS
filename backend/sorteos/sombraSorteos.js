// ==========================================================================
// sorteos/sombraSorteos.js — FASE O5: RECORDATORIOS y AVISO DE CIERRE de los
// sorteos programados en MODO SOMBRA.
//
// sorteos/publicador.js sigue siendo el ÚNICO que envía. Tras cada envío
// (o fallo) llama aquí y el orquestador reconstruye el texto por su cuenta:
//   - vuelve a LEER la copia guardada en el sorteo (sorteos_programados.
//     config + cuentas_snapshot), nunca una plantilla predeterminada: cambiar
//     plantillas o estilos después nunca altera un sorteo ya programado;
//   - genera el texto con el MISMO generador (sorteos/mensajes.js:
//     mensajeRecordatorio / mensajeAvisoCierre, PLANTILLA_CIERRE si el aviso
//     está vacío), con la misma fecha del ciclo;
//   - comprueba que la clave de envío único del motor (la misma fórmula de
//     prioridadComunicaciones.claveCierreSorteo) quedó registrada.
// La publicación (anuncio con imagen) se compara en services/sombraCompartir.js.
//
// Solo lee; sin envíos ni guardián; nunca lanza. Sin la variable
// MENSAJES_ORQUESTADOR_SORTEO=shadow no hace nada, ni siquiera lee.
// ==========================================================================

"use strict";

const { crearOrquestador, comparar } = require("../shared/mensajes");
const { resolverModo, MODOS } = require("../shared/mensajes/modos");
const { huella } = require("../shared/mensajes/etapas/registro");
const { vistaPrevia } = require("../automation/sombraInicioDia");

const ORIGEN = "sorteo";

// Adaptador de sorteos programados: la COPIA guardada + el generador único.
function crearAdaptadorSorteos({ supabase }) {
    return {
        variables: async (s) => {
            const { data, error } = await supabase
                .from("sorteos_programados")
                .select("id, usuario_id, estado, config, cuentas_snapshot")
                .eq("id", s.contexto.sorteoId)
                .eq("usuario_id", s.usuarioId)
                .maybeSingle();
            if (error) throw new Error(error.message || "lectura del sorteo");
            s.contexto.copia = data || null;
            return { copia: data || null };
        },
        renderizar: (_contenido, { copia }, s) => {
            if (!copia?.config) return null;
            const mensajes = require("./mensajes");
            const opciones = { fecha: s.contexto.fecha };
            if (s.tipo === "sorteo_recordatorio") {
                const rec = (copia.config.recordatorios || []).find(x => Number(x.minutos_antes_cierre) === Number(s.contexto.minutos));
                s.contexto.recordatorioEncontrado = Boolean(rec);
                return rec ? mensajes.mensajeRecordatorio(copia.config, rec, copia.cuentas_snapshot || [], opciones).texto : null;
            }
            return mensajes.mensajeAvisoCierre(copia.config, copia.cuentas_snapshot || [], opciones).texto;
        }
    };
}

async function compararSorteoEnSombra({
    deps, sorteo, grupoId, tipo, sufijo, tipoAccion, minutos = null, fecha = null, texto, r,
    entorno = process.env, log = console.log
} = {}) {

    try {
        const modoConfigurado = resolverModo(ORIGEN, entorno);
        if (modoConfigurado === MODOS.OFF) return { omitida: "modo_off" };

        const supabase = deps?.supabase || require("../lib/supabase");
        const { claveCierreSorteo } = require("../automation/prioridadComunicaciones");
        const clave = claveCierreSorteo(sorteo.id, grupoId, sufijo);

        const contexto = { sorteoId: sorteo.id, minutos, fecha, copia: null, recordatorioEncontrado: null };
        const orquestador = crearOrquestador({
            adaptadores: { [ORIGEN]: crearAdaptadorSorteos({ supabase }) },
            modo: () => MODOS.SHADOW,
            registro: { registrar: () => {} }
            // sin `envios` ni `guardian`: imposible enviar o consumir claves.
        });

        const resultado = await orquestador.procesar({
            origen: ORIGEN, tipo, usuarioId: sorteo.usuario_id,
            destino: { jid: grupoId },
            textoAprobado: "",
            claveEnvioUnico: clave, tipoAccion,
            contexto
        }, { modo: MODOS.SHADOW });

        // ¿La clave que el orquestador usaría es la que el motor registró?
        const { data: accion } = await supabase.from("automation_actions").select("clave_idempotencia, estado, tipo_accion").eq("clave_idempotencia", clave).maybeSingle();

        const cmp = comparar(resultado, { enviado: true, texto });
        const campos = cmp.diferencias.map(d => d.campo);
        let motivo = null;
        if (resultado.estado === "error") motivo = `error_orquestador:${resultado.motivo}`;
        else if (!contexto.copia) motivo = "copia_no_encontrada";
        else if (tipo === "sorteo_recordatorio" && contexto.recordatorioEncontrado === false) motivo = "recordatorio_no_encontrado";
        else if (!accion) motivo = "clave_distinta";
        else if (campos.includes("envio")) motivo = resultado.motivo ? `envio_distinto:${resultado.motivo}` : "envio_distinto";
        else if (campos.includes("texto")) motivo = "texto_distinto";

        const entrada = {
            origen: ORIGEN, tipo, modoConfigurado,
            ...(modoConfigurado === MODOS.ACTIVE ? { aviso: "active no está habilitado en O5: solo sombra" } : {}),
            usuarioId: sorteo.usuario_id,
            sorteoId: sorteo.id,
            grupo: huella(grupoId),
            tipoAccion,
            minutos,
            fecha,
            clave: { huella: huella(clave), registradaPorElMotor: Boolean(accion), estado: accion?.estado ?? null },
            copia: contexto.copia ? { estado: contexto.copia.estado, recordatorioEncontrado: contexto.recordatorioEncontrado } : null,
            actual: { estado: r?.ejecutada ? "enviado" : "fallo_envio", huellaTexto: huella(texto), longitud: typeof texto === "string" ? texto.length : null, vistaPrevia: vistaPrevia(texto) },
            orquestador: { estado: resultado.estado, motivo: resultado.motivo || null, fuente: resultado.fuente || null, huellaTexto: huella(resultado.texto), longitud: typeof resultado.texto === "string" ? resultado.texto.length : null, vistaPrevia: vistaPrevia(resultado.texto) },
            coincide: motivo === null,
            diferencias: campos,
            motivo
        };

        log(`[MENSAJES SOMBRA] ${JSON.stringify(entrada)}`);
        return entrada;

    } catch (err) {
        try { log(`[MENSAJES SOMBRA] ${JSON.stringify({ origen: ORIGEN, tipo, error: err?.message || String(err) })}`); } catch { /* nunca lanza */ }
        return { omitida: "error", error: err?.message || String(err) };
    }
}

module.exports = { compararSorteoEnSombra, crearAdaptadorSorteos };
