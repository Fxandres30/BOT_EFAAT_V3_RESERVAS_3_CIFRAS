// ==========================================================================
// esAdministrador() — FASE 2 (infraestructura para confirmación de pago por
// sticker, ver AUDITORÍA sección 8/H/I).
//
// Resuelve en VIVO, contra WhatsApp, si un JID es admin/superadmin del
// grupo dado. A propósito NO persiste nada todavía (pedido explícito): la
// tabla "grupos" hoy solo guarda el CONTEO de participantes
// (bot/funciones/grupos/sincronizarGrupo.js), nunca la lista con roles, así
// que no hay ninguna fuente local confiable — hay que preguntarle a
// WhatsApp cada vez.
//
// Usa services/baileys/groupQueue.js (groupMetadata) en vez de llamar
// sock.groupMetadata(grupoId) directo: es la MISMA llamada, pero pasa por
// la cola central de IQ de grupo que ya usan sincronizarGrupo.js y
// guardarEvento.js (concurrencia 1 + backoff ante rate-overlimit). Llamar
// sock.groupMetadata() suelto desde un módulo nuevo reintroduciría
// exactamente el problema de ráfagas que esa cola existe para evitar.
//
// Identidad: un participante de grupo (Baileys GroupParticipant, ver
// node_modules/@whiskeysockets/baileys/lib/Types/GroupMetadata.d.ts /
// Contact.d.ts) expone `id` (lid o jid, preferido), `lid` (@lid) y
// `phoneNumber` (@s.whatsapp.net) — nunca uno solo. El `jid` que llega
// aquí (desde ctx.chat.participante / message.key.participant) puede venir
// en cualquiera de esas dos formas, así que se compara contra las tres,
// igual que el resto del proyecto nunca asume un único formato de
// identificador (ver comentario de cabecera en
// bot/middleware/obtenerUsuario.js).
// ==========================================================================

const { groupMetadata } = require("../../../services/baileys/groupQueue");

const ROLES_ADMIN = new Set(["admin", "superadmin"]);

async function esAdministrador({ sock, grupoId, jid }) {

    if (!sock || !grupoId || !jid) {

        console.log("⚠ [ADMIN] Faltan datos (sock/grupoId/jid) — se asume NO administrador.");

        return { esAdministrador: false, rol: null };

    }

    let metadata;

    try {

        metadata = await groupMetadata(sock, grupoId);

    } catch (err) {

        console.error("❌ [ADMIN] Error consultando groupMetadata:", err.message);

        // Ante cualquier error de red/rate-limit, NUNCA se asume
        // administrador por defecto — seguridad primero.
        return { esAdministrador: false, rol: null };

    }

    const participantes = metadata?.participants || [];

    const participante = participantes.find(p =>

        p.id === jid ||
        p.lid === jid ||
        p.phoneNumber === jid

    );

    if (!participante) {

        console.log("⚠ [ADMIN] El JID no aparece en participants del grupo — NO administrador.");

        return { esAdministrador: false, rol: null };

    }

    // Baileys expone el rol real en `admin`: "admin" | "superadmin" | null.
    // Un participante normal trae `admin: null` — nunca se interpreta
    // ningún otro valor como administrador.
    const rol = participante.admin || null;

    return {

        esAdministrador: ROLES_ADMIN.has(rol),
        rol

    };

}

module.exports = { esAdministrador };
