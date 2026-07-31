const {
    sincronizarGrupo
} = require("../funciones/grupos/sincronizarGrupo");

// Evita sincronizar varias veces el mismo grupo
const pendientes = new Map();

function programarSincronizacion(sock, grupoId) {

    // Si ya había una sincronización pendiente para este grupo, la cancelamos
    if (pendientes.has(grupoId)) {

        clearTimeout(pendientes.get(grupoId));

    }

    // Esperamos 3 segundos antes de sincronizar
    const timeout = setTimeout(async () => {

        pendientes.delete(grupoId);

        try {

            console.log("🔄 Sincronizando grupo:", grupoId);

            await sincronizarGrupo({

                sock,
                grupoId

            });

        } catch (err) {

            console.error(err);

        }

    }, 3000);

    pendientes.set(grupoId, timeout);

}

function registerGroups(sock) {

    // Cambios de nombre, descripción, configuración, etc.
    sock.ev.on("groups.update", async (updates) => {

        for (const grupo of updates) {

            console.log("📢 groups.update:", grupo.id);

            programarSincronizacion(

                sock,
                grupo.id

            );

        }

    });

    // Entradas y salidas de participantes
    sock.ev.on("group-participants.update", async (data) => {

        console.log("👥 group-participants.update:", data.id);

        programarSincronizacion(

            sock,
            data.id

        );

    });

}

module.exports = {

    registerGroups

};