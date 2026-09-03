const { groupSettingUpdate } = require("../../../../services/baileys/groupQueue");

async function abrirGrupo({

    sock,
    grupoId

}) {

    try {

        // Pasa por la cola central de operaciones IQ de grupo:
        // concurrencia 1 + espaciado + reintento con backoff ante
        // rate-overlimit. Si finalmente falla, lanza -> catch -> false
        // (mismo contrato que antes).
        await groupSettingUpdate(
            sock,
            grupoId,
            "not_announcement"
        );

        console.log("🟢 Grupo abierto");

        return true;

    } catch (error) {

        console.error("❌ Error abriendo grupo");
        console.dir(error, { depth: null });

        return false;

    }

}

module.exports = {
    abrirGrupo
};
