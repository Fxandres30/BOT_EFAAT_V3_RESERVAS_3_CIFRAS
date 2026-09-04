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