async function cerrarGrupo({

    sock,
    grupoId

}) {

    try {

        await sock.groupSettingUpdate(

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