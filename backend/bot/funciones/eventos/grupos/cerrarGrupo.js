const { groupSettingUpdate } = require("../../../../services/baileys/groupQueue");

async function cerrarGrupo({

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
            "announcement"
        );

        console.log("🔒 Grupo cerrado");

        return true;

    } catch (error) {

        console.log("❌ Error cerrando grupo");
        console.dir(error, { depth: null });

        return false;

    }

}

module.exports = {
    cerrarGrupo
};
