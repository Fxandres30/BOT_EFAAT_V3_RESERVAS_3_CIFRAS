const manager = require("./baileys/manager");

async function connect(sessionId) {

    await manager.start(sessionId);

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