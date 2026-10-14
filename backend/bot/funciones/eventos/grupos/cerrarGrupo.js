const { groupSettingUpdate } = require("../../../../services/baileys/groupQueue");

// Restringe el envío de mensajes del grupo a los administradores
// ("announcement"). Devuelve { ok, error } para que el llamador pueda
// registrar el motivo real de un fallo (permisos, conexión, rate-overlimit).
async function cerrarGrupoDetallado({ sock, grupoId }) {

    try {

        // Pasa por la cola central de operaciones IQ de grupo:
        // concurrencia 1 + espaciado + reintento con backoff ante
        // rate-overlimit. Si finalmente falla, lanza -> catch.
        await groupSettingUpdate(
            sock,
            grupoId,
            "announcement"
        );

        console.log("🔒 Grupo cerrado");

        return { ok: true, error: null };

    } catch (error) {

        console.log("❌ Error cerrando grupo");
        console.dir(error, { depth: null });

        return { ok: false, error: error?.message || String(error) };

    }

}

// Contrato de siempre: true si WhatsApp confirmó, false si no.
async function cerrarGrupo({ sock, grupoId }) {

    const { ok } = await cerrarGrupoDetallado({ sock, grupoId });

    return ok;

}

module.exports = {
    cerrarGrupo,
    cerrarGrupoDetallado
};
