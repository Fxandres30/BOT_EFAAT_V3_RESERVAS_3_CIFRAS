// ==========================================================================
// controlDisponibilidad.js — evita respuestas DUPLICADAS y consultas
// CONCURRENTES innecesarias de la tabla de disponibilidad.
//
// Con "actualiza" / "tabla" como disparadores es normal que llegue una
// ráfaga: el mismo cliente escribe "tabla" y "actualiza" seguidos, o dos
// clientes piden la tabla en el mismo segundo. Sin este control, cada
// mensaje haría su propia lectura de Supabase y publicaría su propia tabla.
//
// Reglas (por grupo de WhatsApp):
//   1. EN CURSO: mientras una respuesta de disponibilidad de ese grupo se
//      está calculando/enviando, otra petición del mismo grupo se omite —
//      la tabla que está por salir ya es la vigente.
//   2. MISMO CLIENTE: si a ese cliente ya se le envió la tabla en ese grupo
//      hace menos de DISPONIBILIDAD_VENTANA_USUARIO_MS (30 s), se omite.
//   3. MISMO GRUPO: si ya se publicó una tabla en ese grupo hace menos de
//      DISPONIBILIDAD_VENTANA_GRUPO_MS (8 s), se omite (sigue visible
//      arriba en el chat y no puede estar desactualizada en ese lapso).
//
// La ventana solo se activa cuando la tabla SÍ se envió: si el envío
// falla, el cliente puede volver a pedirla de inmediato. Ventana en 0 =
// regla desactivada.
//
// Estado en memoria del proceso: el bot procesa los mensajes con una sola
// sesión activa por instancia (lease distribuido, ver
// services/baileys/lease.js), así que no hace falta coordinar entre
// procesos. Tras un reinicio solo se pierde la ventana corta, nunca un
// dato de negocio.
// ==========================================================================

function leerMs(nombre, porDefecto) {

    const valor = Number(process.env[nombre]);

    return Number.isFinite(valor) && valor >= 0 ? valor : porDefecto;

}

const enCurso = new Map();                 // grupoId -> ms de inicio
const ultimoEnvioGrupo = new Map();        // grupoId -> ms
const ultimoEnvioUsuario = new Map();      // "grupoId::usuarioId" -> ms

const LIMITE_ENTRADAS = 5000;

function podar(mapa, ventanaMs, ahora) {

    if (mapa.size < LIMITE_ENTRADAS) return;

    for (const [clave, ts] of mapa) {
        if (ahora - ts >= ventanaMs) mapa.delete(clave);
    }

}

// solicitarTurno({ grupoId, usuarioId }) -> { permitido, motivo? }
// Si permitido es true, el llamador DEBE llamar finalizarTurno() después
// (en un finally).
function solicitarTurno({ grupoId, usuarioId, ahora = Date.now() }) {

    if (!grupoId) return { permitido: true };

    const ventanaUsuario = leerMs("DISPONIBILIDAD_VENTANA_USUARIO_MS", 30000);
    const ventanaGrupo = leerMs("DISPONIBILIDAD_VENTANA_GRUPO_MS", 8000);

    // Una respuesta "en curso" que nunca terminó (envío colgado) caduca:
    // nunca deja al grupo sin tabla para siempre.
    const enCursoDesde = enCurso.get(grupoId);
    const caducidadEnCurso = leerMs("DISPONIBILIDAD_EN_CURSO_MAX_MS", 60000);

    if (enCursoDesde !== undefined && ahora - enCursoDesde < caducidadEnCurso) {
        return { permitido: false, motivo: "en_curso_en_grupo" };
    }

    const claveUsuario = `${grupoId}::${usuarioId || ""}`;
    const ultimoUsuario = ultimoEnvioUsuario.get(claveUsuario);

    if (usuarioId && ventanaUsuario > 0 && ultimoUsuario !== undefined && ahora - ultimoUsuario < ventanaUsuario) {
        return { permitido: false, motivo: "duplicado_mismo_cliente" };
    }

    const ultimoGrupo = ultimoEnvioGrupo.get(grupoId);

    if (ventanaGrupo > 0 && ultimoGrupo !== undefined && ahora - ultimoGrupo < ventanaGrupo) {
        return { permitido: false, motivo: "enviada_recientemente_en_grupo" };
    }

    enCurso.set(grupoId, ahora);

    return { permitido: true, token: ahora };

}

function finalizarTurno({ grupoId, usuarioId, enviado, token, ahora = Date.now() }) {

    if (!grupoId) return;

    // Solo libera SU marca: un turno caducado que termina tarde no borra la
    // del turno que lo reemplazó.
    if (token === undefined || enCurso.get(grupoId) === token) enCurso.delete(grupoId);

    if (!enviado) return;

    ultimoEnvioGrupo.set(grupoId, ahora);

    if (usuarioId) ultimoEnvioUsuario.set(`${grupoId}::${usuarioId}`, ahora);

    podar(ultimoEnvioGrupo, leerMs("DISPONIBILIDAD_VENTANA_GRUPO_MS", 8000), ahora);
    podar(ultimoEnvioUsuario, leerMs("DISPONIBILIDAD_VENTANA_USUARIO_MS", 30000), ahora);

}

// Solo para pruebas.
function _reiniciarParaPruebas() {
    enCurso.clear();
    ultimoEnvioGrupo.clear();
    ultimoEnvioUsuario.clear();
}

module.exports = {
    solicitarTurno,
    finalizarTurno,
    _reiniciarParaPruebas
};
