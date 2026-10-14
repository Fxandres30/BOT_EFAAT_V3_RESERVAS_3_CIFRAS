// ==========================================================================
// PRUEBAS — Identity Scanner único (backend/diagnostico/identityScanner/).
//
// Lógica pura (observacion.js) con los 16 casos de identidad, y el scanner
// completo (scanner.js) con un socket falso: desactivado no registra nada,
// activado escribe JSONL anonimizado en un directorio temporal, nunca llama
// a getLIDForPN, nunca modifica el mensaje. Sin Supabase.
//
//     node backend/tests/diagnostico/identityScanner.test.js
// ==========================================================================

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const RAIZ = path.resolve(__dirname, "../..");
const DIR_SCANNER = path.join(RAIZ, "diagnostico/identityScanner");

const { construirObservacion, sanearRaw } = require(path.join(DIR_SCANNER, "observacion.js"));
const { resumir } = require(path.join(DIR_SCANNER, "resumen.js"));

const SAL = "sal-de-prueba";
const PN = "573001112233@s.whatsapp.net";
const PN_NUM = "573001112233";
const LID = "123456789012345@lid";
const LID_NUM = "123456789012345";
const GRUPO = "120363000000000001@g.us";

const obs = (msg) => construirObservacion(msg, { sal: SAL, sessionId: "s1", upsertType: "notify", ahora: new Date("2026-10-03T12:00:00Z") });

function sinIdentificadoresEnClaro(registro, ...valores) {
    const texto = JSON.stringify(registro);
    for (const v of valores) assert.ok(!texto.includes(v), `el registro no debe contener "${v}" en claro`);
}

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

// --------------------------------------------------------- 16 casos puros ---

prueba("1. privado con teléfono", () => {
    const r = obs({ key: { remoteJid: PN, addressingMode: "pn", id: "A1" }, message: { conversation: "hola" }, pushName: "Ana" });
    assert.strictEqual(r.tipoChat, "privado");
    assert.strictEqual(r.remitente.principal.clase, "pn");
    assert.strictEqual(r.remitente.caso, "SOLO_PN");
    sinIdentificadoresEnClaro(r, PN_NUM, "Ana", "hola");
});

prueba("2. privado con LID", () => {
    const r = obs({ key: { remoteJid: LID, addressingMode: "lid" }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.principal.clase, "lid");
    assert.strictEqual(r.remitente.caso, "SOLO_LID");
    sinIdentificadoresEnClaro(r, LID_NUM);
});

prueba("3. teléfono + LID (privado: remoteJid + remoteJidAlt)", () => {
    const r = obs({ key: { remoteJid: LID, remoteJidAlt: PN, addressingMode: "lid" }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.caso, "PN+LID");
    assert.strictEqual(r.remitente.alterno.clase, "pn");
    assert.strictEqual(r.clave.remoteJidAlt.clase, "pn");
});

prueba("4. grupo: el remitente es participant, nunca el grupo", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID, addressingMode: "lid" }, message: { conversation: "x" } });
    assert.strictEqual(r.tipoChat, "grupo");
    assert.strictEqual(r.clave.remoteJid.clase, "grupo");
    assert.strictEqual(r.clave.remoteJid.valor, GRUPO, "el JID del grupo no es dato personal");
    assert.strictEqual(r.remitente.principal.clase, "lid");
});

prueba("5. participantAlt (grupo con LID + teléfono)", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID, participantAlt: PN, addressingMode: "lid" }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.alterno.clase, "pn");
    assert.strictEqual(r.remitente.caso, "PN+LID");
    sinIdentificadoresEnClaro(r, PN_NUM, LID_NUM);
});

prueba("6. username (grupo: participantUsername; privado: remoteJidUsername marcado AMBIGUO)", () => {
    const g = obs({ key: { remoteJid: GRUPO, participant: LID, participantUsername: "andres.efaat" }, message: { conversation: "x" } });
    assert.strictEqual(g.remitente.username.presente, true);
    assert.strictEqual(g.remitente.usernameFuente, "participantUsername");
    sinIdentificadoresEnClaro(g, "andres.efaat");
    const p = obs({ key: { remoteJid: LID, remoteJidUsername: "otro.usuario" }, message: { conversation: "x" } });
    assert.strictEqual(p.remitente.username.presente, true);
    assert.match(p.remitente.usernameFuente, /AMBIGUO/);
});

prueba("7. sin username", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.username.presente, false);
});

prueba("8. citado + mencionados", () => {
    const r = obs({
        key: { remoteJid: GRUPO, participant: PN },
        message: { extendedTextMessage: { text: "dame el 45", contextInfo: { participant: LID, mentionedJid: [PN], quotedMessage: { conversation: "z" } } } }
    });
    assert.strictEqual(r.citado.participant.clase, "lid");
    assert.strictEqual(r.citado.mencionados.length, 1);
    assert.strictEqual(r.citado.conMensajeCitado, true);
});

prueba("9. audio (incluido su citado, que obtenerContextInfo del bot no cubre)", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { audioMessage: { seconds: 3, ptt: true, contextInfo: { participant: PN } } } });
    assert.strictEqual(r.tipoMensaje, "audioMessage");
    assert.strictEqual(r.citado.participant.clase, "pn");
});

prueba("10. efímero", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: "x", contextInfo: { participant: PN } } } } } });
    assert.deepStrictEqual(r.envoltorios, ["ephemeralMessage"]);
    assert.strictEqual(r.tipoMensaje, "extendedTextMessage");
    assert.ok(r.citado);
});

prueba("11. editado (editedMessage y protocolMessage.editedMessage)", () => {
    const a = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { editedMessage: { message: { protocolMessage: { type: 14, editedMessage: { conversation: "71" } } } } } });
    assert.deepStrictEqual(a.envoltorios, ["editedMessage", "protocolMessage.editedMessage"]);
    assert.strictEqual(a.tipoMensaje, "conversation");
    const b = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { protocolMessage: { type: 14, editedMessage: { conversation: "71" } } } });
    assert.deepStrictEqual(b.envoltorios, ["protocolMessage.editedMessage"]);
});

prueba("12. addressingMode pn", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: PN, participantAlt: LID, addressingMode: "pn" }, message: { conversation: "x" } });
    assert.strictEqual(r.clave.addressingMode, "pn");
    assert.strictEqual(r.remitente.principal.clase, "pn");
    assert.strictEqual(r.remitente.alterno.clase, "lid");
});

prueba("13. addressingMode lid", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: LID, participantAlt: PN, addressingMode: "lid" }, message: { conversation: "x" } });
    assert.strictEqual(r.clave.addressingMode, "lid");
    assert.strictEqual(r.remitente.principal.clase, "lid");
});

prueba("14. @hosted (teléfono alojado)", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: `${PN_NUM}@hosted` }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.principal.dominio, "hosted");
    assert.strictEqual(r.remitente.principal.clase, "pn");
});

prueba("15. @hosted.lid", () => {
    const r = obs({ key: { remoteJid: GRUPO, participant: `${LID_NUM}@hosted.lid` }, message: { conversation: "x" } });
    assert.strictEqual(r.remitente.principal.dominio, "hosted.lid");
    assert.strictEqual(r.remitente.principal.clase, "lid");
});

prueba("16. desconocido (dominio, campo de key y tipo de mensaje nuevos)", () => {
    const r = obs({ key: { remoteJid: "abc@algo.nuevo", campoNuevo: 1 }, message: { tipoFuturoMessage: { x: 1 } } });
    assert.strictEqual(r.tipoChat, "desconocido");
    assert.strictEqual(r.remitente.principal.clase, "otro");
    assert.strictEqual(r.remitente.caso, "NINGUNO");
    assert.deepStrictEqual(r.desconocidos.camposKey, ["campoNuevo"]);
    assert.deepStrictEqual(r.desconocidos.tiposMensaje, ["tipoFuturoMessage"]);
});

prueba("correlación: mismo usuario con y sin sufijo de dispositivo -> mismo hash", () => {
    const a = obs({ key: { remoteJid: GRUPO, participant: LID }, message: { conversation: "x" } });
    const b = obs({ key: { remoteJid: GRUPO, participant: `${LID_NUM}:7@lid` }, message: { conversation: "x" } });
    assert.strictEqual(a.remitente.principal.h, b.remitente.principal.h);
    assert.strictEqual(b.remitente.principal.dispositivo, true);
});

prueba("RAW saneado: sin identificadores, texto, claves ni binarios", () => {
    const raw = sanearRaw({
        key: { remoteJid: GRUPO, participant: LID, participantAlt: PN, participantUsername: "andres.efaat", id: "ABC" },
        pushName: "Ana López",
        message: { imageMessage: { caption: "comprobante 3001112233", mediaKey: Buffer.from("secreto"), jpegThumbnail: Buffer.alloc(10), url: "https://mmg.whatsapp.net/firmada" } },
        messageTimestamp: { low: 5, high: 0, toNumber: () => 5 }
    }, SAL);
    sinIdentificadoresEnClaro(raw, PN_NUM, LID_NUM, "andres.efaat", "Ana López", "3001112233", "secreto", "mmg.whatsapp.net");
    assert.strictEqual(raw.message.imageMessage.mediaKey, "[omitido]");
    assert.strictEqual(raw.message.imageMessage.caption, "[texto 22]");
    assert.strictEqual(raw.messageTimestamp, 5);
});

prueba("resumen: estadísticas y señal de identificador cambiado", () => {
    const r1 = obs({ key: { remoteJid: GRUPO, participant: LID, participantAlt: PN }, message: { conversation: "x" } });
    const r2 = obs({ key: { remoteJid: GRUPO, participant: LID, participantAlt: "573009999999@s.whatsapp.net" }, message: { audioMessage: {} } });
    const r3 = obs({ key: { remoteJid: LID }, message: { conversation: "x" } });
    const s = resumir([r1, r2, r3]);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.porCaso["PN+LID"], 2);
    assert.strictEqual(s.porCaso["SOLO_LID"], 1);
    assert.strictEqual(s.identificadoresUnicos.lid, 1);
    assert.strictEqual(s.lidConVariosPn, 1, "el mismo LID visto con dos teléfonos distintos");
});

// -------------------------------------------------- scanner (con E/S) ---

function cargarScanner(env) {
    for (const k of ["IDENTITY_SCANNER", "IDENTITY_SCANNER_RAW", "IDENTITY_SCANNER_DIR", "IDENTITY_SCANNER_SALT"]) delete process.env[k];
    Object.assign(process.env, env);
    delete require.cache[path.join(DIR_SCANNER, "scanner.js")];
    return require(path.join(DIR_SCANNER, "scanner.js"));
}

function sockFalso() {
    const llamadas = { getPNForLID: 0, getLIDForPN: 0 };
    return {
        llamadas,
        sock: {
            ev: new EventEmitter(),
            signalRepository: {
                lidMapping: {
                    getPNForLID: async () => { llamadas.getPNForLID++; return `${PN_NUM}:0@s.whatsapp.net`; },
                    getLIDForPN: async () => { llamadas.getLIDForPN++; return LID; }
                }
            }
        }
    };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

prueba("scanner DESACTIVADO: no registra ningún listener", async () => {
    const scanner = cargarScanner({});
    const { sock } = sockFalso();
    scanner.observarSocket(sock, "s1");
    assert.strictEqual(sock.ev.listenerCount("messages.upsert"), 0);
});

prueba("scanner ACTIVO: JSONL anonimizado, lidMapping solo getPNForLID, mensaje intacto", async () => {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idscan-"));
    const scanner = cargarScanner({ IDENTITY_SCANNER: "true", IDENTITY_SCANNER_DIR: dir, IDENTITY_SCANNER_SALT: SAL });
    const { sock, llamadas } = sockFalso();

    scanner.observarSocket(sock, "s1");
    scanner.observarSocket(sock, "s1"); // no duplica
    assert.strictEqual(sock.ev.listenerCount("messages.upsert"), 1);

    const msg = { key: { remoteJid: GRUPO, participant: LID, addressingMode: "lid", id: "M1" }, message: { conversation: "71" }, pushName: "Ana" };
    const copia = JSON.parse(JSON.stringify(msg));

    sock.ev.emit("messages.upsert", { messages: [msg], type: "notify" });
    await esperar(50);

    assert.deepStrictEqual(msg, copia, "el mensaje no se modifica");
    assert.strictEqual(llamadas.getLIDForPN, 0, "getLIDForPN nunca (hace USync y escribe en la sesión)");
    assert.strictEqual(llamadas.getPNForLID, 1);

    const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    assert.strictEqual(archivos.length, 1);
    const lineas = fs.readFileSync(path.join(dir, archivos[0]), "utf8").trim().split("\n");
    const registro = JSON.parse(lineas[0]);

    assert.strictEqual(registro.remitente.caso, "SOLO_LID");
    assert.strictEqual(registro.lidMapping.pnParaLid[0].pn.clase, "pn", "PN obtenido por lidMapping (anonimizado)");
    assert.match(registro.lidMapping.lidParaPn, /no consultado/);
    assert.strictEqual(registro.raw, undefined, "RAW desactivado por defecto");
    sinIdentificadoresEnClaro(registro, PN_NUM, LID_NUM, "Ana");

    fs.rmSync(dir, { recursive: true, force: true });

});

prueba("scanner con RAW: agrega copia saneada", async () => {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idscan-"));
    const scanner = cargarScanner({ IDENTITY_SCANNER: "true", IDENTITY_SCANNER_RAW: "true", IDENTITY_SCANNER_DIR: dir, IDENTITY_SCANNER_SALT: SAL });
    const { sock } = sockFalso();
    scanner.observarSocket(sock, "s1");

    sock.ev.emit("messages.upsert", { messages: [{ key: { remoteJid: GRUPO, participant: LID }, message: { conversation: "dame el 45" }, pushName: "Ana" }], type: "notify" });
    await esperar(50);

    const archivo = fs.readdirSync(dir).find((f) => f.endsWith(".jsonl"));
    const registro = JSON.parse(fs.readFileSync(path.join(dir, archivo), "utf8").trim());
    assert.ok(registro.raw);
    assert.strictEqual(registro.raw.message.conversation, "[texto 10]");
    sinIdentificadoresEnClaro(registro, PN_NUM, LID_NUM, "Ana", "dame el 45");

    fs.rmSync(dir, { recursive: true, force: true });

});

prueba("seguridad: el scanner no depende de Supabase ni de usuarios/reservas/pagos/IdentitySync", () => {

    // ".from(" = acceso a una tabla (query builder de Supabase). No se busca
    // ".update(" a secas: crypto.createHmac(...).update(...) es legítimo.
    const prohibidos = [/supabase/i, /obtenerUsuario/, /reservarNumeros/, /identitySync/i, /identityResolver/, /confirmarPago|registrarStickerPago/, /\.from\(/, /\.insert\(|\.delete\(|\.upsert\(/, /require\(["']\.\.\/\.\.\/bot/];

    for (const archivo of ["observacion.js", "scanner.js", "resumen.js"]) {
        const fuente = fs.readFileSync(path.join(DIR_SCANNER, archivo), "utf8");
        const codigo = fuente.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
        for (const p of prohibidos) assert.ok(!p.test(codigo), `${archivo} no debe contener ${p}`);
        const requeridos = [...codigo.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
        for (const r of requeridos) assert.ok(["fs", "path", "crypto", "./observacion"].includes(r), `${archivo}: require inesperado ${r}`);
    }

});

(async () => {

    let ok = 0;
    let falla = 0;
    const log = console.log;

    for (const { nombre, fn } of pruebas) {
        console.log = () => {};
        try {
            await fn();
            ok++;
            console.log = log;
            console.log(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            console.log = log;
            console.log(`❌ ${nombre}`);
            console.log(err?.stack || err);
        }
    }

    console.log("\n============================");
    console.log(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    console.log("============================");

    process.exit(falla ? 1 : 0);

})();
