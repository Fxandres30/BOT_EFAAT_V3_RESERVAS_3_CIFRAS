module.exports = function obtenerChat(message) {

    const remoteJid = message.key.remoteJid;

    const esGrupo =
        remoteJid.endsWith("@g.us");

    const esPrivado =
        remoteJid.endsWith("@s.whatsapp.net") ||
        remoteJid.endsWith("@lid");

    const participante =
        message.key.participant || null;

    return {

        remoteJid,

        participante,

        esGrupo,

        esPrivado,

        tipo: esGrupo
            ? "grupo"
            : "privado"

    };

};