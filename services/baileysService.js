const {

    createSocket,

    disconnectSocket

} = require("./baileys/socket");

async function connect(sessionId) {

    await createSocket(sessionId);

    return {

        success: true,

        sessionId

    };

}

async function disconnect(sessionId) {

    await disconnectSocket(sessionId);

    return {

        success: true,

        sessionId

    };

}

module.exports = {

    connect,

    disconnect

};