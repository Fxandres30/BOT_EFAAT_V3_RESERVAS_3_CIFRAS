// ==========================================================================
// NÚCLEO CENTRAL DE ACTIVACIÓN (F4, 06/11/2026).
//
// La otra mitad del ciclo de vida de un evento: cerrarEvento.js lo termina,
// este archivo lo ACTIVA en un grupo. Es solo el ORQUESTADOR: decide el orden
// de los pasos según el perfil de la entrada; cada paso vive en
// lifecycle/activacion/ y las escrituras siguen haciéndolas los servicios de
// siempre (guardarEvento, unSorteoPorPrecio + orquestador de cierre,
// abrirGrupo, compartirEnGrupos, motorEventos).
//
// Entradas (lifecycle/activacion/perfiles.js):
//   anuncio_whatsapp  bot/funciones/eventos/detectarEvento.js
//   panel (programado, instantaneo, grupo_nuevo, reintento_manual)
//                     sorteos/activacionPanel.js ← publicador.publicarEnGrupo
//   reanudacion       todavía no (F4-G: worker y recuperación)
//
// Cada entrada prepara sus datos y sus reglas propias ANTES (identidad, fila
// que se guarda, día y cierre, imagen...) y traduce el resultado a su
// contrato DESPUÉS. El núcleo devuelve un resultado neutro:
//   { resultado, evento?, error?, envio? }  con resultado ∈
//   activado | adoptado | no_autorizado | precio_sin_revisar |
//   precio_sin_reemplazar | sin_guardar | activacion_en_curso | sin_texto |
//   sin_apertura | anuncio_rechazado | anuncio_sin_registro | anuncio_incierto
//
// Dependencias (op.deps), inyectadas por la entrada (las pruebas recargan
// esos módulos con otro Supabase): db, guardarEvento, abrirGrupo, motor y,
// en el panel, actualizarEvento, textoParaCompartir y compartirEnGrupos.
//
// CONCURRENCIA (F4-F, C2): CREAR la fila de un sorteo en un grupo pasa por el
// reclamo persistente ACTIVAR_EVENTO (activacion/reclamoActivacion.js). Quien
// llega segundo ADOPTA la fila del primero:
//   WhatsApp  devuelve la fila adoptada y no hace nada más (sin apertura,
//             ciclo ni sustituciones repetidos);
//   panel     continúa su publicación sobre esa fila, igual que si hubiera
//             llegado después (reutilizarla, abrir, anuncio con imagen, ciclo).
// Reutilizar una fila existente no necesita reclamo (escritura condicionada).
// Ver docs/arquitectura/F4_CREACION_PUBLICACION.md.
// ==========================================================================

"use strict";

const { PERFILES, entradaDelPanel } = require("./activacion/perfiles");
const sustituciones = require("./activacion/sustituciones");
const persistencia = require("./activacion/persistencia");
const apertura = require("./activacion/aperturaGrupo");
const anuncio = require("./activacion/anuncio");
const ciclo = require("./activacion/ciclo");
const reclamoActivacion = require("./activacion/reclamoActivacion");

// Pasos comunes: un sorteo por precio y guardar el evento (deshaciendo el
// reemplazo si no se guardó). -> { evento, reemplazo } | { fallo }
async function sustituirYGuardar(op, { delGrupo, ahora, autorizarOtrosGrupos }) {
    const { deps } = op;
    const precio = await sustituciones.reemplazarDelPrecio({
        db: deps.db, usuarioId: op.usuarioId, grupoId: op.grupoId, valor: op.valor, identidad: op.identidad,
        excepto: op.excepto, delGrupo, motivo: op.motivoReemplazo, ahora, autorizarOtrosGrupos
    });
    if (!precio.ok) {
        const resultado = { lectura: "precio_sin_revisar", no_autorizado: "no_autorizado", error: "precio_sin_reemplazar" }[precio.motivo];
        return { fallo: { resultado, error: precio.error || null } };
    }
    const evento = await persistencia.guardarConReversion({
        db: deps.db, guardarEvento: deps.guardarEvento, datos: op.datosEvento,
        usuarioId: op.usuarioId, reemplazo: precio.reemplazo, motivo: op.motivoReemplazo
    });
    if (!evento) return { fallo: { resultado: "sin_guardar" } };
    return { evento, reemplazo: precio.reemplazo };
}

// ACTIVAR el sorteo en el grupo pasa por el reclamo C2 cuando su fila todavía
// no existe: crearla, o CORREGIR hacia él la fila de otro sorteo sin números
// (la detección cambia esa fila a la identidad anunciada: equivale a crear el
// sorteo en el grupo, F4-F.1). Reutilizar la fila del MISMO sorteo, no.
// -> lo de sustituirYGuardar | { adoptado: fila }
const activaElSorteo = (op) => !op.datosEvento.eventoAnterior || op.datosEvento.eventoAnterior.identidad_evento_real !== op.identidad;

async function crearOReutilizar(op, opciones) {
    if (!activaElSorteo(op)) return sustituirYGuardar(op, opciones);
    const r = await reclamoActivacion.crearOAdoptar({
        db: op.deps.db, usuarioId: op.usuarioId, grupoId: op.grupoId, identidad: op.identidad, entrada: op.entrada,
        consultarEventoDelSorteo: op.deps.consultarEventoDelSorteo,
        propietario: op.sorteo?.id ? { sorteo_id: op.sorteo.id } : null,
        crear: () => sustituirYGuardar(op, opciones)
    });
    if (r.creado) return r.creado;
    if (r.adoptado) return { adoptado: r.adoptado };
    return { fallo: r.fallo };
}

// ---------------------------------------------- anuncio de WhatsApp ---
// Orden propio: guardar → sustituir el de otro precio en ESTE grupo →
// registrar el ciclo → abrir el grupo → (confirmado) tras abrir de la
// entrada y confirmar el ciclo en segundo plano.
async function activarAnuncioWhatsapp(op) {
    const { deps } = op;
    const paso = await crearOReutilizar(op, { delGrupo: [], ahora: undefined, autorizarOtrosGrupos: op.autorizarOtrosGrupos });
    if (paso.fallo) return paso.fallo;
    if (paso.adoptado) return { resultado: "adoptado", evento: paso.adoptado };
    const { evento, reemplazo } = paso;

    console.log("✅ Evento guardado correctamente");

    // Solo después de guardar el nuevo: si guardar falla, el grupo sigue con
    // su sorteo de siempre. (Si era del mismo precio ya se reemplazó.)
    if (op.sustituir && !reemplazo.cerradas.some(f => f.id === op.sustituir.id)) {
        await sustituciones.sustituirEnGrupo({ db: deps.db, evento: op.sustituir, motivo: op.motivoReemplazo });
    }

    // El ciclo es una capa ADICIONAL: nunca bloquea la apertura del grupo.
    const cicloRegistrado = await ciclo.registrarAntesDeAbrir(deps.motor, evento);

    if (await apertura.abrirGrupoDelEvento({ db: deps.db, sock: op.sock, evento, abrirGrupo: deps.abrirGrupo, politica: "deteccion" })) {
        console.log("🔓 Grupo abierto correctamente");
        if (op.trasAbrir) op.trasAbrir(evento);
        ciclo.confirmarEnSegundoPlano(deps.motor, { evento, ciclo: cicloRegistrado, sock: op.sock });
    }

    return { resultado: "activado", evento };
}

// ------------------------------------------------------------- panel ---
// Orden propio: guardar → contadores → texto → abrir el grupo → anuncio con
// imagen (una vez) → ciclo tras el anuncio.
async function activarDesdePanel(op) {
    const { deps } = op;
    const opciones = { delGrupo: op.delGrupo || [], ahora: op.ahora, autorizarOtrosGrupos: null };
    let paso = await crearOReutilizar(op, opciones);
    // Otro (p. ej. el anuncio de WhatsApp) creó la fila a la vez: se reutiliza,
    // como si el panel hubiera llegado después.
    if (paso.adoptado) {
        const fila = paso.adoptado;
        paso = await sustituirYGuardar({ ...op, excepto: fila.id, datosEvento: { ...op.datosEvento, eventoAnterior: fila } }, opciones);
    }
    if (paso.fallo) return paso.fallo;
    const { evento } = paso;

    await persistencia.sincronizarContadores(deps.actualizarEvento, evento);

    const texto = await anuncio.textoDelAnuncio(deps.textoParaCompartir, op.usuarioId, evento);
    if (!texto) return { resultado: "sin_texto", evento };

    // Sin el grupo abierto los clientes no pueden reservar: el anuncio no se
    // envía (el worker también intenta abrirlo: abierto=false).
    if (!(await apertura.abrirGrupoDelEvento({ db: deps.db, sock: op.sock, evento, abrirGrupo: deps.abrirGrupo, politica: "panel" }))) {
        return { resultado: "sin_apertura", evento };
    }

    const envio = await anuncio.enviarAnuncio({ compartirEnGrupos: deps.compartirEnGrupos, evento, sock: op.sock, grupo: op.grupo, sorteo: op.sorteo, texto, imagen: op.imagen });
    if (envio.estado !== "enviado") return { resultado: `anuncio_${envio.estado}`, evento, envio };

    await ciclo.arrancarTrasAnuncio(deps.motor, { evento, sock: op.sock, ahora: op.ahora });
    return { resultado: "activado", evento };
}

// ==========================================================================
// activarEnGrupo(op) — único punto de entrada del núcleo.
//   op.entrada         clave de PERFILES
//   op.usuarioId, op.grupoId, op.sock
//   op.valor, op.identidad, op.excepto  (precio y fila propia a no reemplazar)
//   op.motivoReemplazo                  texto del cierre de los sustituidos
//   op.datosEvento                      argumentos de guardarEvento
//   op.deps.consultarEventoDelSorteo    fila del sorteo en el grupo (C2)
//   WhatsApp: op.sustituir, op.autorizarOtrosGrupos, op.trasAbrir
//   panel:    op.sorteo, op.grupo, op.delGrupo, op.imagen, op.ahora
// ==========================================================================
async function activarEnGrupo(op) {
    const perfil = PERFILES[op?.entrada];
    if (!perfil) throw new Error(`activarEnGrupo: entrada desconocida: ${op?.entrada}`);
    if (perfil.ciclo === "antes_de_abrir") return activarAnuncioWhatsapp(op);
    if (perfil.publicacion === "anuncio") return activarDesdePanel(op);
    throw new Error(`activarEnGrupo: entrada no soportada todavía: ${op.entrada}`);
}

module.exports = { activarEnGrupo, PERFILES, entradaDelPanel };
