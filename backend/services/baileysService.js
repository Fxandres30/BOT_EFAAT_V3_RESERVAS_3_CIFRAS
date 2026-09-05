const manager = require("./baileys/manager");

async function connect(sessionId) {

    const resultado = await manager.start(sessionId);

    if (resultado === manager.SESSION_NOT_FOUND) {

        return {

            success: false,

            code: "SESSION_NOT_FOUND",

            sessionId

        };

    }

    // La sesión existe y está funcionando, pero en la OTRA instancia
    // (LOCAL/VPS) — no es un error de la sesión en sí.
    if (resultado === manager.LEASE_NO_DISPONIBLE) {

        return {

            success: false,

            code: "LEASE_NO_DISPONIBLE",

            sessionId

        };

    }

    return {

        success: true,

        sessionId

    };

}

async function disconnect(sessionId) {

    await manager.stop(sessionId);

    return {

        success: true,

        sessionId

    };

}

async function status(sessionId) {

    return {

        success: true,

        connected: manager.has(sessionId)

    };

}

module.exports = {

    connect,

    disconnect,

    status

};