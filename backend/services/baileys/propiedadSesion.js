// ==========================================================================
// PROPIEDAD DE SESIÓN — "¿este socket puede ejecutar acciones de negocio?"
// ==========================================================================
// Única regla compartida por todo lo que actúa sobre WhatsApp en segundo
// plano o desde listeners del socket (listeners de grupos, cola de IQ de
// grupo, workerEventos, scheduler). Un socket solo puede actuar si:
//
//   1. pertenece a la sesión ACTIVA del bot,
//   2. está OPEN (cicloSocket.js),
//   3. sigue siendo el socket VIGENTE de esa sesión (no uno reemplazado).
//
// La regla real la instala bot/index.js (iniciarBot) con
// manager.esSocketVigenteActivo — se inyecta en vez de requerir el
// manager aquí para no formar ciclos de require (manager -> socket ->
// groups -> ...) y para que las pruebas que usan sockets falsos sin
// manager sigan funcionando igual (por defecto, sin configurar, se
// permite todo: exactamente el comportamiento previo).
// ==========================================================================

let validador = null;

function configurar(fn) {

    validador = typeof fn === "function" ? fn : null;

}

function puedeActuar(sock) {

    if (!validador) return true;

    try {
        return !!validador(sock);
    } catch (err) {
        console.error("❌ [PROPIEDAD SESIÓN] error evaluando el socket, se bloquea la acción:", err?.message);
        return false;
    }

}

function describir(sock) {

    return sock?.context?.sessionId || "(socket sin sesión)";

}

module.exports = {
    configurar,
    puedeActuar,
    describir
};
