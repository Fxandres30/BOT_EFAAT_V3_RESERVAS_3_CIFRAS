// ==========================================================================
// identidadParticipante.js — ¿QUIÉN de los participantes reales de un grupo
// es el bloqueado? Funciones puras (sin Supabase ni WhatsApp).
//
// Regla: se expulsa a UN participante concreto, con el id exacto que devolvió
// groupMetadata, y solo si la identificación no deja dudas.
//
//   1. Coincidencia por LID o JID registrados en el bloqueo (exacta, sin el
//      sufijo de dispositivo ":n"). Es la identificación preferida.
//   2. Solo si no hay coincidencia exacta, por teléfono (phoneNumber del
//      participante o su id @s.whatsapp.net), y solo si:
//        - exactamente UN participante tiene ese teléfono, y
//        - ese participante no tiene un LID DISTINTO del registrado (sería
//          otra persona con el mismo número reasignado).
//   3. Cualquier contradicción (LID apunta a uno y teléfono a otro, dos
//      participantes con el mismo identificador) => "ambiguo": no se expulsa.
//   4. "ausente" solo si TODOS los participantes exponen algún identificador
//      comparable con el bloqueo. Si alguno no (p. ej. el bloqueo solo tiene
//      teléfono y el grupo solo muestra LID), no se puede afirmar que no
//      esté => "no_verificable".
// ==========================================================================

const ROLES_ADMIN = new Set(["admin", "superadmin"]);

// "123:4@LID" -> "123@lid". null si no parece un JID.
function normalizarJid(valor) {

    const texto = String(valor || "").trim().toLowerCase();

    if (!texto.includes("@")) return null;

    const [usuario, dominio] = texto.split("@");
    const base = usuario.split(":")[0];

    return base && dominio ? `${base}@${dominio}` : null;

}

// Mismo criterio que normalizarIdentificadoresDesdeJid (obtenerUsuarioGlobal.js),
// con el que se guardó bloqueados.telefono: dígitos del JID sin el 57 inicial.
function telefonoDeJid(jid) {

    const n = normalizarJid(jid);

    if (!n || !n.endsWith("@s.whatsapp.net")) return null;

    return n.split("@")[0].replace(/^57/, "") || null;

}

function identificadoresDe(p) {

    const jids = new Set([p?.id, p?.lid, p?.phoneNumber, p?.jid].map(normalizarJid).filter(Boolean));

    const lid = [...jids].find(j => j.endsWith("@lid")) || null;
    const telefono = telefonoDeJid(p?.phoneNumber) || telefonoDeJid(p?.id) || telefonoDeJid(p?.jid);

    return { jids, lid, telefono };

}

function esAdministrador(p) {
    return ROLES_ADMIN.has(p?.admin || null);
}

// ids normalizados de la cuenta conectada (sock.user).
function idsDeCuenta(sock) {
    return new Set([sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber].map(normalizarJid).filter(Boolean));
}

function interseca(a, b) {
    for (const x of a) if (b.has(x)) return true;
    return false;
}

// Participante de la propia cuenta conectada (o null).
function participanteDeCuenta(participantes, sock) {
    const ids = idsDeCuenta(sock);
    if (!ids.size) return null;
    return participantes.find(p => interseca(identificadoresDe(p).jids, ids)) || null;
}

function esPropietario(p, metadata) {
    const duenos = new Set([metadata?.owner, metadata?.ownerPn, metadata?.ownerJid].map(normalizarJid).filter(Boolean));
    return duenos.size > 0 && interseca(identificadoresDe(p).jids, duenos);
}

// { estado: "encontrado", participante, criterio } | { estado: "ausente" } |
// { estado: "ambiguo", motivo } | { estado: "no_verificable", motivo }
function localizarParticipante(participantes, bloqueo, { excluir = new Set() } = {}) {

    const lidB = normalizarJid(bloqueo?.lid);
    const jidB = normalizarJid(bloqueo?.jid);
    const telB = bloqueo?.telefono ? String(bloqueo.telefono).replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "") : null;

    if (!lidB && !jidB && !telB) return { estado: "no_verificable", motivo: "el bloqueo no tiene teléfono, LID ni JID" };

    const lista = (participantes || []).filter(p => !interseca(identificadoresDe(p).jids, excluir));

    const exactos = lista.filter(p => {
        const { jids } = identificadoresDe(p);
        return (lidB && jids.has(lidB)) || (jidB && jids.has(jidB));
    });

    const porTelefono = telB ? lista.filter(p => identificadoresDe(p).telefono === telB) : [];

    if (exactos.length > 1) return { estado: "ambiguo", motivo: "varios participantes coinciden con el LID/JID registrado" };

    if (exactos.length === 1) {

        const p = exactos[0];

        if (porTelefono.some(x => x !== p)) {
            return { estado: "ambiguo", motivo: "el LID/JID apunta a un participante y el teléfono a otro distinto" };
        }

        return { estado: "encontrado", participante: p, criterio: "lid_jid" };

    }

    if (porTelefono.length > 1) return { estado: "ambiguo", motivo: "varios participantes tienen el mismo teléfono" };

    if (porTelefono.length === 1) {

        const p = porTelefono[0];
        const lidP = identificadoresDe(p).lid;

        if (lidB && lidP && lidP !== lidB) {
            return { estado: "ambiguo", motivo: "el teléfono coincide pero el participante tiene otro LID (posible número reasignado)" };
        }

        return { estado: "encontrado", participante: p, criterio: "telefono" };

    }

    // Nadie coincide. ¿Se puede afirmar? Solo si cada participante expone un
    // identificador del mismo tipo que alguno del bloqueo.
    const buscaLid = !!lidB || !!jidB?.endsWith("@lid");
    const buscaTelefono = !!telB || !!jidB?.endsWith("@s.whatsapp.net");

    const incomparables = lista.filter(p => {
        const ids = identificadoresDe(p);
        return !((buscaLid && ids.lid) || (buscaTelefono && ids.telefono));
    });

    if (incomparables.length > 0) {
        return { estado: "no_verificable", motivo: `no se pudo comparar la identidad de ${incomparables.length} participante(s) (el grupo no expone el mismo tipo de identificador que el bloqueo)` };
    }

    return { estado: "ausente" };

}

// ¿Sigue en la lista el participante exacto sobre el que se actuó?
function sigueEnGrupo(participantes, participanteJid) {

    const objetivo = normalizarJid(participanteJid);
    if (!objetivo) return false;

    return (participantes || []).some(p => identificadoresDe(p).jids.has(objetivo));

}

module.exports = {
    normalizarJid,
    telefonoDeJid,
    identificadoresDe,
    esAdministrador,
    idsDeCuenta,
    participanteDeCuenta,
    esPropietario,
    localizarParticipante,
    sigueEnGrupo
};
