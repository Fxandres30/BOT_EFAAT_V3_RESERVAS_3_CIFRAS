// ==========================================================================
// Pruebas del NUEVO IdentityScanner (capa independiente, ver
// bot/funciones/usuarios/identityScanner/). NO usa Supabase, NO usa
// Baileys real — solo objetos fijos (fixtures) que imitan formas reales de
// Baileys 7.0.0-rc14 (mensaje, participante de grupo, grupo completo).
//
// Mismo patrón que los demás tests del repo: contadores pasaron/fallaron,
// sin librería externa. Ejecutar: node backend/_test_identity_scanner.js
// ==========================================================================

const {
    escanearObjeto,
    escanearMensaje,
    escanearGrupo,
    escanearTodosLosGrupos
} = require("./bot/funciones/usuarios/identityScanner");

let pasaron = 0, fallaron = 0;
const fallos = [];

function assert(cond, msg) {
    if (cond) { pasaron++; console.log("✅", msg); }
    else { fallaron++; fallos.push(msg); console.log("❌", msg); }
}

function assertEq(actual, esperado, msg) {
    assert(actual === esperado, `${msg} — esperado=${JSON.stringify(esperado)} obtenido=${JSON.stringify(actual)}`);
}

// ==========================================================================
// 1) Mensaje real de Baileys — identidad en varios campos a la vez
// ==========================================================================
console.log("\n=== 1) Mensaje real: participant + participantAlt + contextInfo + mentionedJid ===\n");

const mensajeFixture = {
    key: {
        remoteJid: "120363012345678901@g.us",
        participant: "573001234567:0@s.whatsapp.net",
        participantAlt: "111222333444555@lid",
        fromMe: false,
        id: "ABCD1234"
    },
    pushName: "Cliente Prueba",
    message: {
        extendedTextMessage: {
            text: "quiero el 27",
            contextInfo: {
                participant: "666777888999000@lid",
                mentionedJid: [
                    "573109876543:2@s.whatsapp.net",
                    "222333444555666@lid"
                ]
            }
        }
    }
};

{
    const r = escanearMensaje(mensajeFixture);

    assert(r.telefonos.includes("3001234567"), "encuentra el teléfono de key.participant (con sufijo de dispositivo y '57' quitados)");
    assert(r.telefonos.includes("3109876543"), "encuentra el teléfono dentro de contextInfo.mentionedJid (array anidado)");
    assert(r.lids.includes("111222333444555@lid"), "encuentra el LID de key.participantAlt");
    assert(r.lids.includes("666777888999000@lid"), "encuentra el LID de contextInfo.participant");
    assert(r.lids.includes("222333444555666@lid"), "encuentra el LID dentro de mentionedJid (array anidado)");
    assertEq(r.telefonos.length, 2, "NO se queda con el primer teléfono — devuelve los 2 encontrados");
    assertEq(r.lids.length, 3, "NO se queda con el primer LID — devuelve los 3 encontrados");

    const candidatoParticipant = r.candidatos.find(c => c.crudo === "573001234567:0@s.whatsapp.net");
    assertEq(candidatoParticipant?.source, "message.key.participant", "cada candidato indica su source exacto (key.participant)");

    const candidatoMentioned = r.candidatos.find(c => c.crudo === "222333444555666@lid");
    assert(candidatoMentioned?.source?.includes("mentionedJid[1]"), "el source de un hallazgo dentro de un array incluye el índice (mentionedJid[1])");
}

// ==========================================================================
// 2) Dominios "hosted" y "hosted.lid" — variante que ni el scanner antiguo
//    ni extraerJids.js/obtenerUsuarioGlobal.js reconocen hoy.
// ==========================================================================
console.log("\n=== 2) Variantes @hosted y @hosted.lid (verificadas contra el paquete instalado) ===\n");

{
    const fixtureHosted = {
        nivel1: { nivel2: { nivel3: {
            telefonoHosted: "3005551234@hosted",
            lidHosted: "987654321@hosted.lid"
        } } }
    };

    const r = escanearObjeto(fixtureHosted);

    assert(r.telefonos.includes("3005551234"), "@hosted se clasifica como teléfono, incluso a 3 niveles de profundidad");
    assert(r.lids.includes("987654321@hosted.lid"), "@hosted.lid se clasifica como LID (no se lo come el patrón de 'hosted')");
    assert(!r.telefonos.includes("987654321"), "@hosted.lid NUNCA se convierte en teléfono");
    assert(!r.lids.some(l => l.includes("3005551234")), "@hosted NUNCA se convierte en LID");
}

// ==========================================================================
// 3) JID incrustado dentro de un string más largo — corrige el bug real del
//    scanner antiguo (usaba el string COMPLETO como si fuera el JID).
// ==========================================================================
console.log("\n=== 3) JID incrustado en texto libre (bug real del scanner antiguo) ===\n");

{
    const textoConJidIncrustado = "reenviado desde 573001112233@s.whatsapp.net por el administrador";

    // Replica exacta de la regla del scanner antiguo (BOT_Escaner_1.0/functions/escanearGrupo.js::extraerDeObjeto):
    //   if (data.includes("@s.whatsapp.net") && !telefono) telefono = data.split("@")[0]
    const comoLoHariaElAntiguo = textoConJidIncrustado.includes("@s.whatsapp.net")
        ? textoConJidIncrustado.split("@")[0]
        : null;

    assert(
        comoLoHariaElAntiguo !== "573001112233",
        `el criterio del scanner antiguo NO aísla el JID incrustado (produce basura: "${comoLoHariaElAntiguo}")`
    );

    const r = escanearObjeto({ texto: textoConJidIncrustado });

    assert(r.telefonos.includes("3001112233"), "el nuevo scanner SÍ aísla el JID exacto aunque esté incrustado en un texto más largo");
}

// ==========================================================================
// 4) Sufijo de dispositivo del LID — el bug ya documentado en producción
//    (ver escanerIdentidades.js::usuarioDeJid, "BUG REAL encontrado en
//    producción" para la identidad del propio bot).
// ==========================================================================
console.log("\n=== 4) LID con sufijo de dispositivo — sinSufijoDispositivo ===\n");

{
    const r = escanearObjeto({ lid: "7156153774273:11@lid" });

    assert(r.lids.includes("7156153774273:11@lid"), "el LID se conserva completo (con sufijo), igual que el resto del sistema");

    const candidato = r.candidatos.find(c => c.tipo === "lid");
    assertEq(candidato.sinSufijoDispositivo, "7156153774273@lid", "se calcula la variante sin sufijo de dispositivo, para comparar con el escáner de grupo");
}

// ==========================================================================
// 5) Teléfono inválido — se conserva marcado, no se descarta ni se inventa
// ==========================================================================
console.log("\n=== 5) Teléfono con longitud inválida — se conserva, marcado 'valido: false' ===\n");

{
    const r = escanearObjeto({ raro: "5512345@s.whatsapp.net" }); // 7 dígitos, no es un celular colombiano válido

    assertEq(r.telefonos.length, 1, "el candidato inválido SÍ aparece en la lista (no se descarta en silencio)");

    const candidato = r.candidatos.find(c => c.tipo === "phone");
    assertEq(candidato.valido, false, "queda marcado como no válido (longitud != 10) en vez de forzarlo o descartarlo");
}

// ==========================================================================
// 6) Teléfono con "57" real de 12 dígitos vs. un "57" que NO es prefijo de país
// ==========================================================================
console.log("\n=== 6) '57' inicial solo se quita cuando el crudo tiene 12 dígitos exactos ===\n");

{
    const r1 = escanearObjeto({ a: "573001234567:0@s.whatsapp.net" }); // 12 dígitos -> sí se quita 57
    assert(r1.telefonos.includes("3001234567"), "12 dígitos empezando en 57 -> se quita el prefijo de país");

    const r2 = escanearObjeto({ a: "5712345@s.whatsapp.net" }); // 7 dígitos -> NO se toca el '57'
    const candidato2 = r2.candidatos.find(c => c.tipo === "phone");
    assertEq(candidato2.valor, "5712345", "menos de 12 dígitos -> el '57' NO se interpreta como prefijo de país (se conserva tal cual)");
}

// ==========================================================================
// 7) Nunca confundir JID de grupo/broadcast/newsletter con identidad de persona
// ==========================================================================
console.log("\n=== 7) @g.us / @broadcast / @newsletter no son identidad de persona ===\n");

{
    const r = escanearObjeto({
        grupo: "120363012345678901@g.us",
        estado: "status@broadcast",
        canal: "120363099999999999@newsletter"
    });

    assertEq(r.telefonos.length, 0, "ningún JID de grupo/estado/canal termina en telefonos");
    assertEq(r.lids.length, 0, "ningún JID de grupo/estado/canal termina en lids");
    assertEq(r.candidatos.length, 0, "ninguno de los 3 genera un candidato de identidad");
}

// ==========================================================================
// 8) Ciclos — no debe colgarse ni fallar
// ==========================================================================
console.log("\n=== 8) Referencia circular — no cuelga, no lanza, sigue encontrando lo real ===\n");

{
    const obj = { lid: "444555666777888@lid" };
    obj.selfRef = obj; // ciclo real

    const inicio = Date.now();
    const r = escanearObjeto(obj);
    const duracionMs = Date.now() - inicio;

    assert(r.lids.includes("444555666777888@lid"), "encuentra el LID real a pesar del ciclo");
    assert(duracionMs < 1000, `termina rápido a pesar del ciclo (${duracionMs}ms)`);
}

// ==========================================================================
// 9) Buffers grandes (media real) — se saltan, no se recorren byte a byte
// ==========================================================================
console.log("\n=== 9) Buffer grande (simula media real) — se ignora, no ralentiza ni ensucia resultados ===\n");

{
    const bufferGrande = Buffer.alloc(3 * 1024 * 1024, 7); // 3 MB
    const obj = {
        mediaKey: bufferGrande,
        telefono: "573001234567@s.whatsapp.net"
    };

    const inicio = Date.now();
    const r = escanearObjeto(obj);
    const duracionMs = Date.now() - inicio;

    assert(r.telefonos.includes("3001234567"), "sigue encontrando el teléfono real junto a un Buffer grande");
    assert(duracionMs < 300, `el Buffer no se recorre byte a byte (${duracionMs}ms para 3MB)`);
}

// ==========================================================================
// 10) Grupo completo — participantes en distintas formas + owner del grupo
// ==========================================================================
console.log("\n=== 10) escanearGrupo() — participantes + owner, formas mixtas ===\n");

{
    const grupoFixture = {
        id: "120363012345678901@g.us",
        subject: "Rifa de prueba",
        owner: "573009998877@s.whatsapp.net",
        participants: [
            { id: "111111111111111@lid" }, // solo LID visible (modo LID puro)
            { id: "573002223344@s.whatsapp.net" }, // solo teléfono visible
            { id: "222222222222222@lid", lid: "222222222222222@lid", phoneNumber: "573005556677@s.whatsapp.net" } // ambos
        ]
    };

    const r = escanearGrupo(grupoFixture);

    assert(r.telefonos.includes("3009998877"), "encuentra el teléfono del owner del grupo (no solo participants)");
    assert(r.lids.includes("111111111111111@lid"), "participante solo-LID detectado");
    assert(r.telefonos.includes("3002223344"), "participante solo-teléfono detectado");
    assert(r.lids.includes("222222222222222@lid") && r.telefonos.includes("3005556677"), "participante con ambos: se detectan LID y teléfono a la vez, sin pisarse");
}

// ==========================================================================
// 11) escanearTodosLosGrupos() — agrega varios grupos con un sock falso
// ==========================================================================
console.log("\n=== 11) escanearTodosLosGrupos() — agrega varios grupos (sock falso, sin red real) ===\n");

(async () => {

    const sockFalso = {
        groupFetchAllParticipating: async () => ({
            "grupoA@g.us": {
                id: "grupoA@g.us",
                participants: [{ id: "111000111@lid" }, { id: "573001112222@s.whatsapp.net" }]
            },
            "grupoB@g.us": {
                id: "grupoB@g.us",
                participants: [{ id: "222000222@lid" }, { id: "111000111@lid" }] // 111000111 repetido a propósito (misma persona, 2 grupos)
            }
        })
    };

    const r = await escanearTodosLosGrupos(sockFalso);

    assertEq(r.gruposEncontrados, 2, "cuenta los 2 grupos del sock falso");
    assertEq(r.participantesAnalizados, 4, "cuenta los 4 participantes analizados (2+2)");
    assert(r.lids.includes("111000111@lid") && r.lids.includes("222000222@lid"), "combina LIDs de ambos grupos");
    assert(r.telefonos.includes("3001112222"), "combina teléfonos de ambos grupos");
    assertEq(r.lids.filter(l => l === "111000111@lid").length, 1, "la persona repetida en 2 grupos NO se duplica en la lista deduplicada 'lids'");
    assertEq(r.candidatos.filter(c => c.crudo === "111000111@lid").length, 2, "pero SÍ quedan 2 candidatos (uno por grupo) — no se pierde evidencia de en qué grupos apareció");

    // ---- sock sin groupFetchAllParticipating -> debe fallar explícito, no en silencio ----
    let lanzoError = false;
    try {
        await escanearTodosLosGrupos({});
    } catch (e) {
        lanzoError = true;
    }
    assert(lanzoError, "sin groupFetchAllParticipating(), lanza error explícito (no falla en silencio ni devuelve vacío)");

    // ======================================================================
    // RESUMEN
    // ======================================================================
    console.log("\n============================");
    console.log(`TOTAL: ${pasaron + fallaron}  ✅ PASA: ${pasaron}  ❌ FALLA: ${fallaron}`);
    console.log("============================\n");

    if (fallaron > 0) {
        console.log("Fallos:");
        fallos.forEach(f => console.log(" -", f));
        process.exit(1);
    }

})();
