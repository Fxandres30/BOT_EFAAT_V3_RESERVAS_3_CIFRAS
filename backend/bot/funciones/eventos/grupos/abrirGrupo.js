async function abrirGrupo({

    sock,
    grupoId

}) {

    try {

        await sock.groupSettingUpdate(

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