const {
    sincronizarGrupo
} = require("../funciones/grupos/sincronizarGrupo");

// FASE 2 (IdentitySync, sección 3): "group-participants.update" es el
// evento REAL de Baileys que ya existía y ya estaba conectado en este
// mismo archivo (para sincronizarGrupo, el conteo de participantes en la
// tabla "grupos") — no se inventa un evento nuevo. Se reutiliza el MISMO
// escaneo incremental que ya usa la apertura de grupo
// (detectarEvento.js/workerEventos.js -> escanearGrupo), con su misma
// protección "un escaneo por grupo a la vez" (escaneosDeGrupoEnCurso) — así
// que si alguien entra justo cuando el grupo se está abriendo, el segundo
// disparador simplemente se omite, no compite.
const {
    escanearGrupo
} = require("../funciones/usuarios/escanerIdentidadesLifecycle");

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

        console.log("👥 group-participants.update:", data.id, "| acción:", data.action);

        programarSincronizacion(

            sock,
            data.id

        );

        // Sección 3: solo cuando alguien ENTRA (no en remove/promote/demote
        // — esas acciones no traen una identidad nueva que descubrir).
        // Fire-and-forget, igual que el resto de disparadores del escáner
        // de identidades — nunca debe retrasar ni afectar este listener.
        if (data.action === "add") {

            const sessionIdParaEscaner = sock?.context?.sessionId || null;

            if (sessionIdParaEscaner) {

                escanearGrupo(sessionIdParaEscaner, sock, data.id).catch(err => {

                    console.error(`❌ [ESCÁNER IDENTIDADES] error tras nuevo participante en ${data.id}:`, err?.message);

                });

            }

        }

    });

}

module.exports = {

    registerGroups

};