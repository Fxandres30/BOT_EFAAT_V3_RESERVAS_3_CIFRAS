module.exports = function obtenerChat(message) {

    if (!message || !message.key) {
        return null;
    }

    const remoteJid = message.key.remoteJid;

    if (!remoteJid) {
        return null;
    }

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