const sessions = new Map();

function addSession(id, socket) {

    sessions.set(id, {

        socket,

        qr: null,

        connected: false

    });

}

function getSession(id) {

    return sessions.get(id);

}

function removeSession(id) {

    sessions.delete(id);

}

function getAllSessions() {

    return [...sessions.values()];

}

module.exports = {

    addSession,

    getSession,

    removeSession,

    getAllSessions

};