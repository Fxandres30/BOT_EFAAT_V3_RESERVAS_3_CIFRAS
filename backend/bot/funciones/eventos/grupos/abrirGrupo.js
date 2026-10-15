const { groupSettingUpdate } = require("../../../../services/baileys/groupQueue");

// Permite el envío de mensajes a todos ("not_announcement"). Devuelve
// { ok, error } con el error ORIGINAL para que el llamador pueda distinguir
// el motivo (permisos, conexión, rate-overlimit). Mismo criterio que
// cerrarGrupoDetallado.
async function abrirGrupoDetallado({ sock, grupoId }) {

    try {

        // Pasa por la cola central de operaciones IQ de grupo:
        // concurrencia 1 + espaciado + reintento con backoff ante
        // rate-overlimit. Si finalmente falla, lanza -> catch.
        await groupSettingUpdate(
            sock,
            grupoId,
            "not_announcement"
        );

        console.log("🟢 Grupo abierto");

        return { ok: true, error: null };

    } catch (error) {

        console.error("❌ Error abriendo grupo");
        console.dir(error, { depth: null });

        return { ok: false, error };

    }

}

// Contrato de siempre: true si WhatsApp confirmó, false si no.
async function abrirGrupo({

    sock,
    grupoId

}) {

    const { ok } = await abrirGrupoDetallado({ sock, grupoId });

    return ok;

}

module.exports = {
    abrirGrupo,
    abrirGrupoDetallado
};
