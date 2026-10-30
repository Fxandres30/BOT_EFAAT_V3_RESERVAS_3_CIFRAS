// ==========================================================================
// PRUEBAS SIMULADAS — expulsión centralizada de bloqueados (migración 040).
//
// Todo en memoria: Supabase falso (tests/sorteos/fakeSupabaseSorteos.js) y
// sockets de WhatsApp falsos que registran cada llamada. NINGUNA prueba
// consulta ni modifica producción ni envía nada a WhatsApp: lib/supabase.js
// y services/baileys/manager.js se sustituyen ANTES de cargar cualquier
// módulo (lib/supabase.js real consulta producción al cargarse).
//
// Esto NO es una prueba real con WhatsApp: los status ('200', '403', ...)
// y la lista de participantes los fabrica el socket falso con la forma que
// devuelve Baileys 7.0.0-rc14 (lib/Socket/groups.js).
//
//     node backend/tests/bloqueo/expulsionesBloqueo.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const http = require("http");

process.env.GROUP_QUEUE_DELAY_MS = "0";
process.env.SESSIONS_API_TOKEN = "token-servicio-prueba";
delete process.env.BLOQUEO_EXPULSION_MODO;
delete process.env.BLOQUEO_EXPULSION_CONFIRMAR;

const { crearFake } = require("../sorteos/fakeSupabaseSorteos");

const RAIZ = path.resolve(__dirname, "../..");
const ruta = r => path.join(RAIZ, r);

function inyectar(rutaRel, exportsObj) {
    const abs = ruta(rutaRel);
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

const fake = crearFake();
inyectar("lib/supabase.js", fake.client);

// Socket activo de cada cliente (lo que devolvería el manager real).
const sockets = new Map();
inyectar("services/baileys/manager.js", { getSocketActivoDe: u => sockets.get(u) || null });

const repo = require(ruta("bot/funciones/bloqueo/expulsionesRepo.js"));
const bloqueadosRepo = require(ruta("bot/funciones/bloqueo/bloqueadosRepo.js"));
const { procesarPendientesDe, statusDe } = require(ruta("bot/funciones/bloqueo/procesarExpulsion.js"));
const identidad = require(ruta("bot/funciones/bloqueo/identidadParticipante.js"));
const bloqueoActivo = require(ruta("bot/funciones/bloqueo/bloqueoActivo.js"));
const politicaGrupos = require(ruta("bot/funciones/grupos/politicaGrupos.js"));
const { leerConfigExpulsiones } = require(ruta("bot/funciones/bloqueo/configExpulsiones.js"));

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

const TEL = "3001112233";
const LID = "111222333@lid";
const PERSONA = { id: LID, phoneNumber: "573001112233@s.whatsapp.net", admin: null };

const CUENTA = { id: "573000000000:7@s.whatsapp.net", lid: "999000:7@lid" };
const CUENTA_EN_GRUPO = { id: "999000@lid", phoneNumber: "573000000000@s.whatsapp.net", admin: "admin" };

const OTRO = (n) => ({ id: `55500${n}@lid`, phoneNumber: `57310000000${n}@s.whatsapp.net`, admin: null });

const CONFIG = { modo: "real", leaseSegundos: 120, maxIntentos: 3, esperaBaseMs: 60000, esperaMaxMs: 600000, lote: 10 };

let desplazamientoMs = 0;
const ahora = () => new Date(Date.now() + desplazamientoMs);

function reiniciar() {
    for (const k of Object.keys(fake.tablas)) delete fake.tablas[k];
    sockets.clear();
    politicaGrupos.olvidarAutorizacion();
    bloqueoActivo.olvidarBloqueos();
    desplazamientoMs = 0;
}

function grupo(participantes, { conCuenta = true, cuentaAdmin = true, owner = null } = {}) {
    const cuenta = conCuenta ? [{ ...CUENTA_EN_GRUPO, admin: cuentaAdmin ? "admin" : null }] : [];
    return { owner, participants: [...cuenta, ...participantes] };
}

// Socket falso con la forma de Baileys: groupMetadata y
// groupParticipantsUpdate -> [{ status, jid }]. Si el status es '200' quita
// al participante de su lista (como haría WhatsApp).
function crearSock({ usuarioId = A, grupos = {}, status = () => "200", lanzar = null, aplicar = true, lecturaFalla = null } = {}) {

    const estado = { grupos: JSON.parse(JSON.stringify(grupos)), llamadas: [], lecturas: [] };

    const sock = {
        context: { usuarioId, sessionId: `ses-${usuarioId.slice(0, 4)}` },
        user: CUENTA,
        vigente: true,
        estado,
        async groupMetadata(g) {
            estado.lecturas.push(g);
            if (lecturaFalla) { const e = lecturaFalla(g, estado.lecturas.filter(x => x === g).length); if (e) throw e; }
            const gr = estado.grupos[g];
            if (!gr) throw new Error("item-not-found");
            return { id: g, owner: gr.owner, participants: gr.participants.map(p => ({ ...p })) };
        },
        async groupParticipantsUpdate(g, jids, accion) {
            estado.llamadas.push({ g, jids, accion });
            if (lanzar) { const e = lanzar(g); if (e) throw e; }
            const s = status(g, jids[0]);
            if (s === "200" && aplicar) estado.grupos[g].participants = estado.grupos[g].participants.filter(p => p.id !== jids[0]);
            return jids.map(j => ({ status: s, jid: j }));
        }
    };

    sockets.set(usuarioId, sock);

    return sock;

}

function deps({ real = true } = {}) {
    return {
        repo,
        registrarIntento: bloqueadosRepo.registrarIntentoExpulsion,
        obtenerSocket: u => sockets.get(u) || null,
        puedeActuar: s => !!s && s.vigente !== false,
        groupMetadata: (s, g) => s.groupMetadata(g),
        groupParticipantsUpdate: (s, g, p, a) => s.groupParticipantsUpdate(g, p, a),
        evaluarGrupo: politicaGrupos.evaluarGrupo,
        expulsionesReales: () => real,
        ahora
    };
}

const correr = (usuarioId = A, { real = true, config = {} } = {}) =>
    procesarPendientesDe(usuarioId, { config: { ...CONFIG, modo: real ? "real" : "simulacion", ...config }, deps: deps({ real }) });

async function escenario({ grupos = ["g1@g.us"], bloqueo = { telefono: TEL, lid: LID }, usuarioId = A } = {}) {

    for (const g of grupos) {
        (fake.tablas.grupos_autorizados ||= []).push({ usuario_id: usuarioId, grupo_id: g, activo: true });
        (fake.tablas.grupos ||= []).push({ jid: g, nombre: `Grupo ${g.split("@")[0]}` });
    }

    const creado = await bloqueadosRepo.crearBloqueo({ usuarioId, ...bloqueo });
    assert.ok(creado.ok, JSON.stringify(creado));

    const programadas = await repo.programarExpulsiones({ usuarioId, bloqueado: creado.bloqueado });
    assert.ok(programadas.ok, JSON.stringify(programadas));

    return { bloqueado: creado.bloqueado, programadas };

}

const tareasDe = (bloqueadoId) => (fake.tablas.bloqueo_expulsiones || []).filter(t => t.bloqueado_id === bloqueadoId);
const tareaDe = (bloqueadoId, g) => tareasDe(bloqueadoId).find(t => t.grupo_id === g);
const intentosDe = (bloqueadoId) => (fake.tablas.bloqueo_intentos || []).filter(i => i.bloqueado_id === bloqueadoId);

const resultados = [];

async function prueba(nombre, fn) {
    reiniciar();
    const log = console.log, warn = console.warn, error = console.error;
    const capturado = [];
    console.log = console.warn = console.error = (...a) => capturado.push(a.join(" "));
    try {
        await fn();
        console.log = log; console.warn = warn; console.error = error;
        resultados.push({ nombre, ok: true });
        console.log(`✅ ${nombre}`);
    } catch (err) {
        console.log = log; console.warn = warn; console.error = error;
        resultados.push({ nombre, ok: false });
        console.log(`❌ ${nombre}\n   ${err.stack?.split("\n").slice(0, 3).join("\n   ")}`);
        if (capturado.length) console.log("   --- log ---\n   " + capturado.slice(-12).join("\n   "));
    }
}

async function main() {

    // ------------------------------------------------------------------ 1
    await prueba("1. presente en un grupo -> expulsado y verificado con la lista real", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA, OTRO(1)]) } });

        await correr();

        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "expulsado");
        assert.ok(t.verificada_en, "debe quedar la hora de verificación");
        assert.strictEqual(t.participante_jid, LID, "se expulsa con el id EXACTO de groupMetadata");
        assert.strictEqual(t.ultimo_status, "200");
        assert.deepStrictEqual(sock.estado.llamadas.map(l => [l.g, l.jids, l.accion]), [["g1@g.us", [LID], "remove"]]);
        assert.strictEqual(sock.estado.lecturas.length, 2, "una lectura antes y otra para verificar");
        assert.strictEqual(fake.tablas.bloqueados[0].expulsiones, 1);
        assert.strictEqual(intentosDe(bloqueado.id).at(-1).resultado, "expulsado");
    });

    // ------------------------------------------------------------------ 2
    await prueba("2. presente en varios grupos -> una expulsión por grupo, todas verificadas", async () => {
        const grupos = ["g1@g.us", "g2@g.us", "g3@g.us"];
        const { bloqueado } = await escenario({ grupos });
        const sock = crearSock({ grupos: Object.fromEntries(grupos.map(g => [g, grupo([PERSONA])])) });

        await correr();

        assert.deepStrictEqual(tareasDe(bloqueado.id).map(t => t.estado).sort(), ["expulsado", "expulsado", "expulsado"]);
        assert.strictEqual(sock.estado.llamadas.length, 3);
        assert.strictEqual(repo.estadoGeneral(bloqueado, tareasDe(bloqueado.id)), "expulsado_de_todos");
        assert.strictEqual(fake.tablas.bloqueados[0].expulsiones, 3);
    });

    // ------------------------------------------------------------------ 3
    await prueba("3. ya no está en el grupo -> ya_no_estaba, sin enviar nada", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([OTRO(1), OTRO(2)]) } });

        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "ya_no_estaba");
        assert.strictEqual(sock.estado.llamadas.length, 0);
        assert.strictEqual(fake.tablas.bloqueados[0].expulsiones, 0, "ya_no_estaba no cuenta como expulsión");
    });

    // ------------------------------------------------------------------ 4
    await prueba("4. cuenta conectada sin permisos de administrador -> sin_permisos, reintentable, nada enviado", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA], { cuentaAdmin: false }) } });

        await correr();

        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "sin_permisos");
        assert.ok(t.proximo_intento_en, "queda programado un reintento automático");
        assert.strictEqual(sock.estado.llamadas.length, 0);
        assert.strictEqual(repo.estadoGeneral(bloqueado, tareasDe(bloqueado.id)), "error_permisos");
    });

    // ------------------------------------------------------------------ 5
    await prueba("5. participante administrador o propietario -> no_expulsable, nada enviado", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us"] });
        const sock = crearSock({
            grupos: {
                "g1@g.us": grupo([{ ...PERSONA, admin: "admin" }]),
                "g2@g.us": grupo([PERSONA], { owner: "573001112233@s.whatsapp.net" })
            }
        });

        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "no_expulsable");
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "no_expulsable");
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    // ------------------------------------------------------------------ 6
    await prueba("6. sesión desconectada -> sesion_desconectada sin gastar intentos; al reconectar se completa", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us"] });

        await correr(); // sin socket

        assert.deepStrictEqual(tareasDe(bloqueado.id).map(t => [t.estado, t.intentos]), [["sesion_desconectada", 0], ["sesion_desconectada", 0]]);
        assert.strictEqual(repo.estadoGeneral(bloqueado, tareasDe(bloqueado.id)), "sesion_desconectada");

        // Un socket de OTRO cliente conectado no sirve.
        crearSock({ usuarioId: B, grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]) } });
        await correr();
        assert.ok(tareasDe(bloqueado.id).every(t => t.estado === "sesion_desconectada"));
        assert.strictEqual(sockets.get(B).estado.llamadas.length, 0, "nunca se usa el WhatsApp de otro cliente");

        // Socket no vigente (reemplazado/cerrado) tampoco.
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]) } });
        sock.vigente = false;
        await correr();
        assert.strictEqual(sock.estado.llamadas.length, 0);

        sock.vigente = true;
        await repo.reactivarSinSesion(A, { ahora: ahora() });
        await correr();

        assert.deepStrictEqual(tareasDe(bloqueado.id).map(t => t.estado), ["expulsado", "expulsado"]);
    });

    // ------------------------------------------------------------------ 7
    await prueba("7. WhatsApp responde 403 (sin lanzar error) -> sin_permisos, nunca 'expulsado'", async () => {
        const { bloqueado } = await escenario();
        crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) }, status: () => "403" });

        await correr();

        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "sin_permisos");
        assert.strictEqual(t.ultimo_status, "403");
        assert.strictEqual(fake.tablas.bloqueados[0].expulsiones, 0);
        assert.strictEqual(intentosDe(bloqueado.id).at(-1).status_whatsapp, "403");
    });

    // ------------------------------------------------------------------ 8
    await prueba("8. WhatsApp responde 404 -> ya_no_estaba", async () => {
        const { bloqueado } = await escenario();
        crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) }, status: () => "404" });

        await correr();

        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "ya_no_estaba");
        assert.strictEqual(t.ultimo_status, "404");
    });

    // ------------------------------------------------------------------ 9
    await prueba("9. error de WhatsApp en uno de varios grupos -> los demás siguen; 200 sin salir del grupo = sin_verificar", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us"] });
        const sock = crearSock({
            grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]), "g3@g.us": grupo([PERSONA]), "g4@g.us": grupo([PERSONA]) },
            lanzar: g => (g === "g1@g.us" ? new Error("internal-server-error") : null),
            status: g => (g === "g3@g.us" ? "500" : "200"),
            aplicar: true
        });
        // g4: WhatsApp dice 200 pero la persona sigue apareciendo.
        const original = sock.groupParticipantsUpdate.bind(sock);
        sock.groupParticipantsUpdate = async (g, j, a) => (g === "g4@g.us" ? (sock.estado.llamadas.push({ g, jids: j, accion: a }), [{ status: "200", jid: j[0] }]) : original(g, j, a));

        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "error_whatsapp");
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "expulsado");
        assert.strictEqual(tareaDe(bloqueado.id, "g3@g.us").estado, "error_whatsapp");
        assert.match(tareaDe(bloqueado.id, "g3@g.us").ultimo_error, /500/);
        assert.strictEqual(tareaDe(bloqueado.id, "g4@g.us").estado, "sin_verificar");
        assert.strictEqual(sock.estado.llamadas.length, 4, "un grupo con error no detiene a los demás");
        assert.strictEqual(repo.estadoGeneral(bloqueado, tareasDe(bloqueado.id)), "parcial");
    });

    // ----------------------------------------------------------------- 10
    await prueba("10. grupo solo con LID (sin teléfono) y LID con sufijo de dispositivo -> identificado por LID exacto", async () => {
        const { bloqueado } = await escenario({ bloqueo: { telefono: TEL, lid: "111222333:12@lid" } });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([{ id: LID, admin: null }, { id: "777@lid", admin: null }]) } });

        await correr();

        const t = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t.estado, "expulsado");
        assert.strictEqual(t.criterio_identidad, "lid_jid");
        assert.deepStrictEqual(sock.estado.llamadas[0].jids, [LID]);
    });

    // ----------------------------------------------------------------- 11
    await prueba("11. coincidencias telefónicas ambiguas -> identidad_ambigua, nunca se expulsa a nadie", async () => {
        // a) solo teléfono y dos participantes con ese teléfono.
        const a = await escenario({ grupos: ["g1@g.us", "g2@g.us", "g3@g.us"], bloqueo: { telefono: TEL } });
        const sock = crearSock({
            grupos: {
                "g1@g.us": grupo([{ id: "1@lid", phoneNumber: "573001112233@s.whatsapp.net" }, { id: "2@lid", phoneNumber: "573001112233:3@s.whatsapp.net" }]),
                // b) el teléfono coincide con alguien que tiene OTRO LID (el bloqueo trae LID, ver abajo).
                "g2@g.us": grupo([{ id: "888@lid", phoneNumber: "573001112233@s.whatsapp.net" }]),
                // c) solo teléfono y el grupo no expone teléfonos: no se puede afirmar que no esté.
                "g3@g.us": grupo([{ id: "4@lid" }, { id: "5@lid" }])
            }
        });

        // El bloqueo de (b) necesita LID: se completa aquí.
        fake.tablas.bloqueados[0].lid = null;
        await correr();
        assert.strictEqual(tareaDe(a.bloqueado.id, "g1@g.us").estado, "identidad_ambigua");
        assert.strictEqual(tareaDe(a.bloqueado.id, "g3@g.us").estado, "identidad_ambigua");
        assert.match(tareaDe(a.bloqueado.id, "g3@g.us").ultimo_error, /no se pudo comparar/);
        // g2 sin LID en el bloqueo: un único participante con el teléfono -> se acepta por teléfono.
        assert.strictEqual(tareaDe(a.bloqueado.id, "g2@g.us").estado, "expulsado");
        assert.strictEqual(tareaDe(a.bloqueado.id, "g2@g.us").criterio_identidad, "telefono");

        // b) con LID registrado distinto del del participante.
        const r = identidad.localizarParticipante([{ id: "888@lid", phoneNumber: "573001112233@s.whatsapp.net" }], { telefono: TEL, lid: LID });
        assert.strictEqual(r.estado, "ambiguo");
        // d) LID apunta a uno y teléfono a otro.
        const d = identidad.localizarParticipante([{ id: LID }, { id: "9@lid", phoneNumber: "573001112233@s.whatsapp.net" }], { telefono: TEL, lid: LID });
        assert.strictEqual(d.estado, "ambiguo");
        assert.deepStrictEqual(sock.estado.llamadas.map(l => l.g), ["g2@g.us"], "solo se actuó donde la identidad era inequívoca");
    });

    // ----------------------------------------------------------------- 12
    await prueba("12. reintentos: espera progresiva, reintento manual solo de lo no resuelto, sin duplicar expulsiones", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us"] });
        let fallar = true;
        const sock = crearSock({
            grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]) },
            lanzar: g => (g === "g1@g.us" && fallar ? new Error("internal-server-error") : null)
        });

        await correr();
        const t1 = tareaDe(bloqueado.id, "g1@g.us");
        assert.strictEqual(t1.estado, "error_whatsapp");
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "expulsado");
        const espera = new Date(t1.proximo_intento_en) - ahora();
        assert.ok(espera > 50000 && espera <= 60000, `primer reintento ~60 s (fue ${espera})`);

        // Antes de su turno no se reintenta.
        await correr();
        assert.strictEqual(sock.estado.llamadas.length, 2);

        // Segundo fallo: la espera se duplica.
        desplazamientoMs = 61000;
        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").intentos, 2);
        const espera2 = new Date(tareaDe(bloqueado.id, "g1@g.us").proximo_intento_en) - ahora();
        assert.ok(espera2 > 110000 && espera2 <= 120000, `segundo reintento ~120 s (fue ${espera2})`);

        // Tercer fallo (maxIntentos=3): sin más reintentos automáticos.
        desplazamientoMs += 121000;
        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").proximo_intento_en, null);
        assert.match(tareaDe(bloqueado.id, "g1@g.us").ultimo_error, /agotados/);

        // Reintento manual: solo g1 vuelve a la cola; g2 (expulsado) no.
        fallar = false;
        const r = await repo.reintentarDeBloqueo(A, bloqueado.id, { ahora: ahora() });
        assert.strictEqual(r.reprogramadas, 1);
        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "expulsado");
        assert.strictEqual(sock.estado.llamadas.filter(l => l.g === "g2@g.us").length, 1, "g2 nunca se vuelve a expulsar");
    });

    // ----------------------------------------------------------------- 13
    await prueba("13. dos solicitudes simultáneas -> un solo bloqueo, una tarea por grupo, una expulsión por grupo", async () => {
        fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }, { usuario_id: A, grupo_id: "g2@g.us", activo: true }];

        // Carrera del INSERT: el índice único de la 019 rechaza el segundo.
        const fromOriginal = fake.client.from;
        let carrera = true;
        fake.client.from = (tabla) => {
            const q = fromOriginal(tabla);
            if (tabla === "bloqueados" && carrera) {
                const insertar = q.insert;
                q.insert = (fila) => {
                    carrera = false;
                    fake.tablas.bloqueados.push({ id: "00000000-0000-4000-8000-0000000000b1", ...fila, activo: true });
                    insertar.call(q, fila);
                    return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
                };
            }
            return q;
        };

        let creado;
        try {
            creado = await bloqueadosRepo.crearBloqueo({ usuarioId: A, telefono: TEL, lid: LID });
        } finally {
            fake.client.from = fromOriginal;
        }

        assert.ok(creado.ok, "la colisión del índice único no es un error para el panel");
        assert.strictEqual(creado.bloqueado.id, "00000000-0000-4000-8000-0000000000b1");

        // Segundo clic: yaActivo, nada se reinicia.
        const segundo = await bloqueadosRepo.crearBloqueo({ usuarioId: A, telefono: TEL, lid: LID });
        assert.strictEqual(segundo.yaActivo, true);

        await Promise.all([
            repo.programarExpulsiones({ usuarioId: A, bloqueado: creado.bloqueado }),
            repo.programarExpulsiones({ usuarioId: A, bloqueado: creado.bloqueado })
        ]);
        assert.strictEqual(tareasDe(creado.bloqueado.id).length, 2, "sin tareas duplicadas");

        // Dos instancias intentan tomar la MISMA tarea a la vez.
        const t = tareaDe(creado.bloqueado.id, "g1@g.us");
        const [x, y] = await Promise.all([
            repo.tomarTarea(t, { instancia: "instancia-1", ahora: ahora() }),
            repo.tomarTarea(t, { instancia: "instancia-2", ahora: ahora() })
        ]);
        assert.strictEqual([x.tarea, y.tarea].filter(Boolean).length, 1, "solo una instancia obtiene el lease");
        // Se libera para el resto de la prueba (lease vencido).
        tareaDe(creado.bloqueado.id, "g1@g.us").lease_hasta = new Date(Date.now() - 1000).toISOString();

        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]) } });
        await Promise.all([correr(), correr(), correr()]);

        assert.strictEqual(sock.estado.llamadas.filter(l => l.g === "g1@g.us").length, 1);
        assert.strictEqual(sock.estado.llamadas.filter(l => l.g === "g2@g.us").length, 1);
    });

    // ----------------------------------------------------------------- 14
    await prueba("14. aislamiento entre clientes: grupos, sesiones y tareas de cada uno", async () => {
        fake.tablas.grupos_autorizados = [
            { usuario_id: A, grupo_id: "gA@g.us", activo: true },
            { usuario_id: B, grupo_id: "gB@g.us", activo: true },
            { usuario_id: A, grupo_id: "gViejo@g.us", activo: false }
        ];

        const { bloqueado } = await escenario({ grupos: [] });
        assert.deepStrictEqual(tareasDe(bloqueado.id).map(t => t.grupo_id), ["gA@g.us"], "solo grupos autorizados y activos de A");

        const sockA = crearSock({ usuarioId: A, grupos: { "gA@g.us": grupo([PERSONA]) } });
        const sockB = crearSock({ usuarioId: B, grupos: { "gA@g.us": grupo([PERSONA]), "gB@g.us": grupo([PERSONA]) } });

        // El worker de B no toca tareas de A.
        await correr(B);
        assert.strictEqual(tareaDe(bloqueado.id, "gA@g.us").estado, "pendiente");
        assert.strictEqual(sockB.estado.llamadas.length, 0);

        // Si el grupo se desautoriza antes de procesar: se cancela, no se expulsa.
        fake.tablas.grupos_autorizados[0].activo = false;
        politicaGrupos.olvidarAutorizacion();
        await correr(A);
        assert.strictEqual(tareaDe(bloqueado.id, "gA@g.us").estado, "cancelado");
        assert.strictEqual(sockA.estado.llamadas.length, 0);

        // Un bloqueo de A no afecta a B.
        assert.strictEqual((await bloqueoActivo.buscarBloqueo(B, { telefono: TEL, lid: LID })).bloqueado, null);
        assert.ok((await bloqueoActivo.buscarBloqueo(A, { telefono: TEL })).bloqueado);

        // Una tarea con bloqueo de otro cliente no se programa.
        const ajeno = await repo.programarExpulsiones({ usuarioId: B, bloqueado });
        assert.strictEqual(ajeno.ok, false);
    });

    // ----------------------------------------------------------------- 15
    await prueba("15. bloqueo durante una reserva -> reservarNumeros no reserva; mensajes del bloqueado sin negocio", async () => {
        const { reservarNumeros } = require(ruta("bot/funciones/reservas/reservarNumeros.js"));

        fake.tablas.t_prueba = [{ numero: "05", estado: "libre", usuario_id: A }, { numero: "06", estado: "libre", usuario_id: A }];
        const evento = { id: "ev-1", usuario_id: A, tabla: "t_prueba", grupo_id: "g1@g.us", grupo_nombre: "G1" };
        const usuario = { id: "u-1", telefono: TEL, lid: LID, nombre: "Ana" };

        // Caché del dispatcher "calentada" sin bloqueo.
        assert.strictEqual((await bloqueoActivo.buscarBloqueo(A, { telefono: TEL })).bloqueado, null);

        // Antes de bloquear, reserva normal.
        const antes = await reservarNumeros({ evento, numeros: ["05"], usuario });
        assert.strictEqual(antes.length, 1);

        // Bloqueo hecho por OTRO proceso (sin invalidar la caché de este).
        (fake.tablas.bloqueados ||= []).push({ id: "b-x", usuario_id: A, telefono: TEL, lid: LID, activo: true });

        const durante = await reservarNumeros({ evento, numeros: ["06"], usuario });
        assert.deepStrictEqual(durante, [], "lectura fresca: no se reserva aunque la caché diga lo contrario");
        assert.strictEqual(fake.tablas.t_prueba[1].estado, "libre");

        // Un contacto NO bloqueado sigue reservando.
        const otro = await reservarNumeros({ evento, numeros: ["06"], usuario: { id: "u-2", telefono: "3105556677", nombre: "Beto" } });
        assert.strictEqual(otro.length, 1);

        // Autor de un mensaje (dispatcher): bloqueado por LID o por teléfono; fromMe nunca.
        bloqueoActivo.olvidarBloqueos(A);
        const ctx = (extra) => ({ message: { key: { fromMe: false, participant: LID } }, chat: { participante: LID, esGrupo: true }, usuario: {}, ...extra });
        assert.ok(await bloqueoActivo.bloqueoDelAutor(A, ctx()));
        assert.ok(await bloqueoActivo.bloqueoDelAutor(A, ctx({ chat: { participante: "otro@lid", esGrupo: true }, usuario: { telefono: TEL } })));
        assert.strictEqual(await bloqueoActivo.bloqueoDelAutor(A, ctx({ message: { key: { fromMe: true } } })), null);
        assert.strictEqual(await bloqueoActivo.bloqueoDelAutor(B, ctx()), null, "el bloqueo es solo del cliente que bloqueó");

        // Supabase falla: no se bloquea a nadie por un error de lectura.
        bloqueoActivo.olvidarBloqueos(A);
        fake.control.fallarTabla = "bloqueados";
        try {
            assert.strictEqual((await bloqueoActivo.buscarBloqueo(A, { telefono: TEL })).verificado, false);
        } finally {
            fake.control.fallarTabla = null;
        }
    });

    // ----------------------------------------------------------------- 16
    await prueba("16. reinicio del worker durante una operación -> el lease vence, otra instancia la retoma sin duplicar", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us"] });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([OTRO(1)]), "g2@g.us": grupo([PERSONA]) } });

        // Instancia "muerta": tomó g1, anotó el envío (la expulsión SÍ llegó:
        // la persona ya no está) y murió antes de cerrar. Tomó también g2
        // y murió antes de enviar.
        const t1 = (await repo.tomarTarea(tareaDe(bloqueado.id, "g1@g.us"), { instancia: "muerta", ahora: ahora() })).tarea;
        await repo.anotarEnvio(t1, { instancia: "muerta", participanteJid: LID, criterio: "lid_jid", sessionId: "s", modo: "real" });
        const t2 = (await repo.tomarTarea(tareaDe(bloqueado.id, "g2@g.us"), { instancia: "muerta", ahora: ahora() })).tarea;
        assert.ok(t1 && t2);

        // Lease vigente: nadie la toca.
        await correr();
        assert.strictEqual(sock.estado.llamadas.length, 0);
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "en_curso");

        // El lease vence (reinicio): la nueva instancia retoma ambas.
        desplazamientoMs = 3 * 60 * 1000;
        await correr();

        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "ya_no_estaba", "no se reenvía: se verifica que ya no está");
        assert.match(tareaDe(bloqueado.id, "g1@g.us").ultimo_error, /interrumpi/);
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "expulsado");
        assert.deepStrictEqual(sock.estado.llamadas.map(l => l.g), ["g2@g.us"]);

        // La instancia muerta "revive" e intenta cerrar: no pisa el resultado.
        const tarde = await repo.cerrarTarea(t2, { estado: "error_whatsapp" }, { instancia: "muerta" });
        assert.strictEqual(tarde.ok, false);
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "expulsado");
    });

    // ------------------------------------------------------ complementarias
    await prueba("simulación: nunca llama a groupParticipantsUpdate; al activar real se procesan las simuladas", async () => {
        const { bloqueado } = await escenario();
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });

        await correr(A, { real: false });
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "simulado");
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").participante_jid, LID);
        assert.strictEqual(sock.estado.llamadas.length, 0);
        assert.strictEqual(repo.estadoGeneral(bloqueado, tareasDe(bloqueado.id)), "simulado");

        // Config en "real" pero la segunda barrera (entorno) no confirma.
        tareaDe(bloqueado.id, "g1@g.us").estado = "pendiente";
        tareaDe(bloqueado.id, "g1@g.us").proximo_intento_en = new Date(0).toISOString();
        await procesarPendientesDe(A, { config: { ...CONFIG, modo: "real" }, deps: deps({ real: false }) });
        assert.strictEqual(sock.estado.llamadas.length, 0, "sin confirmación en el entorno no se expulsa");

        await correr(A, { real: true });
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "expulsado");
    });

    await prueba("configuración: sin variable = desactivado; real sin confirmar = simulación", async () => {
        delete process.env.BLOQUEO_EXPULSION_MODO;
        assert.strictEqual(leerConfigExpulsiones().modo, "desactivado");
        process.env.BLOQUEO_EXPULSION_MODO = "simulacion";
        assert.strictEqual(leerConfigExpulsiones().modo, "simulacion");
        process.env.BLOQUEO_EXPULSION_MODO = "real";
        assert.strictEqual(leerConfigExpulsiones().modo, "simulacion");
        process.env.BLOQUEO_EXPULSION_CONFIRMAR = "SI";
        assert.strictEqual(leerConfigExpulsiones().modo, "real");
        delete process.env.BLOQUEO_EXPULSION_MODO;
        delete process.env.BLOQUEO_EXPULSION_CONFIRMAR;
        assert.strictEqual((await procesarPendientesDe(A)).motivo, "desactivado");
    });

    await prueba("desbloquear: cancela lo pendiente; la tarea en curso se cancela al releer el bloqueo", async () => {
        const { bloqueado } = await escenario({ grupos: ["g1@g.us", "g2@g.us"] });
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]), "g2@g.us": grupo([PERSONA]) } });

        const enCurso = (await repo.tomarTarea(tareaDe(bloqueado.id, "g1@g.us"), { instancia: "x", ahora: ahora() })).tarea;
        await bloqueadosRepo.desbloquear(bloqueado.id, A);
        await repo.cancelarDeBloqueo(A, bloqueado.id);
        assert.strictEqual(tareaDe(bloqueado.id, "g2@g.us").estado, "cancelado");

        tareaDe(bloqueado.id, "g1@g.us").lease_hasta = new Date(Date.now() - 1000).toISOString();
        await correr();
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "cancelado");
        assert.ok(enCurso);
        assert.strictEqual(sock.estado.llamadas.length, 0);
    });

    await prueba("status por participante de Baileys", async () => {
        assert.strictEqual(statusDe([{ status: "403", jid: "1@lid" }, { status: "200", jid: LID }], LID), "200");
        assert.strictEqual(statusDe([{ status: "404", jid: "x@lid" }], LID), "404");
        assert.strictEqual(statusDe([], LID), null);
        assert.strictEqual(statusDe(undefined, LID), null);
    });

    await prueba("reingreso de un bloqueado: usa el mismo motor (modo del entorno)", async () => {
        const { procesarIngresoParticipante, _limpiarLocksParaPruebas } = require(ruta("bot/funciones/bloqueo/bloqueoParticipantesGrupo.js"));
        _limpiarLocksParaPruebas();

        const { bloqueado } = await escenario();
        // Ya se había expulsado; vuelve a entrar.
        tareaDe(bloqueado.id, "g1@g.us").estado = "expulsado";
        const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });

        // Sin modo definido: se programa pero no se expulsa.
        const r0 = await procesarIngresoParticipante(sock, "g1@g.us", PERSONA);
        assert.strictEqual(r0.expulsado, false);
        assert.strictEqual(tareaDe(bloqueado.id, "g1@g.us").estado, "pendiente");
        assert.strictEqual(sock.estado.llamadas.length, 0);

        _limpiarLocksParaPruebas();
        process.env.BLOQUEO_EXPULSION_MODO = "real";
        process.env.BLOQUEO_EXPULSION_CONFIRMAR = "SI";
        try {
            const r1 = await procesarIngresoParticipante(sock, "g1@g.us", PERSONA);
            assert.strictEqual(r1.expulsado, true, JSON.stringify(r1));
        } finally {
            delete process.env.BLOQUEO_EXPULSION_MODO;
            delete process.env.BLOQUEO_EXPULSION_CONFIRMAR;
        }

        assert.strictEqual(sock.estado.llamadas.length, 1);
        assert.strictEqual(fake.tablas.bloqueados[0].intentos_ingreso, 1);
        assert.strictEqual(intentosDe(bloqueado.id).at(-1).origen, "reingreso");
    });

    await prueba("rutas HTTP: bloquear (doble clic), detalle, reintentar y aislamiento por token", async () => {
        fake.tokens["jwt-A"] = A;
        fake.tokens["jwt-B"] = B;
        fake.tablas.grupos_autorizados = [{ usuario_id: A, grupo_id: "g1@g.us", activo: true }];

        const express = require("express");
        const app = express();
        app.use(express.json());
        app.use("/bloqueados", require(ruta("routes/bloqueados.js")));
        const servidor = app.listen(0);
        const base = `http://127.0.0.1:${servidor.address().port}`;

        const pedir = (metodo, camino, jwt, cuerpo) => new Promise((resolve, reject) => {
            const req = http.request(base + camino, { method: metodo, headers: { "Content-Type": "application/json", "x-service-token": process.env.SESSIONS_API_TOKEN, Authorization: `Bearer ${jwt}` } }, res => {
                let datos = "";
                res.on("data", c => { datos += c; });
                res.on("end", () => resolve({ status: res.statusCode, cuerpo: JSON.parse(datos || "{}") }));
            });
            req.on("error", reject);
            if (cuerpo) req.write(JSON.stringify(cuerpo));
            req.end();
        });

        try {
            const sock = crearSock({ grupos: { "g1@g.us": grupo([PERSONA]) } });
            sock.updateBlockStatus = async () => {};

            const [r1, r2] = await Promise.all([
                pedir("POST", "/bloqueados", "jwt-A", { telefono: TEL, lid: LID }),
                pedir("POST", "/bloqueados", "jwt-A", { telefono: TEL, lid: LID })
            ]);
            assert.strictEqual(r1.status, 200);
            assert.strictEqual(r2.status, 200);
            assert.strictEqual(r1.cuerpo.expulsion.modo, "desactivado");
            assert.strictEqual(r1.cuerpo.expulsion.estado, "expulsion_pendiente");

            const id = r1.cuerpo.bloqueado.id;
            assert.strictEqual(r2.cuerpo.bloqueado.id, id, "las dos peticiones responden con el MISMO bloqueo");
            assert.strictEqual(fake.tablas.bloqueados.length, 1);
            assert.strictEqual(tareasDe(id).length, 1, "una tarea aunque llegaran dos peticiones");

            // B no ve ni reintenta el bloqueo de A.
            assert.strictEqual((await pedir("GET", `/bloqueados/${id}/expulsiones`, "jwt-B")).status, 404);
            assert.strictEqual((await pedir("POST", `/bloqueados/${id}/reintentar`, "jwt-B")).status, 404);

            await correr(A, { real: false });

            const detalle = await pedir("GET", `/bloqueados/${id}/expulsiones`, "jwt-A");
            assert.strictEqual(detalle.status, 200);
            assert.strictEqual(detalle.cuerpo.expulsion.estado, "simulado");
            assert.strictEqual(detalle.cuerpo.grupos[0].estado, "simulado");
            assert.ok(detalle.cuerpo.intentos.some(i => i.resultado === "simulado"));
            assert.strictEqual(detalle.cuerpo.bloqueado.bloqueo_nativo_estado, "aplicado");

            const lista = await pedir("GET", "/bloqueados", "jwt-A");
            assert.strictEqual(lista.cuerpo.bloqueados[0].expulsion.estado, "simulado");

            const reintento = await pedir("POST", `/bloqueados/${id}/reintentar`, "jwt-A");
            assert.strictEqual(reintento.status, 200);
            assert.strictEqual(reintento.cuerpo.reprogramadas, 1);

            const desbloqueo = await pedir("POST", `/bloqueados/${id}/desbloquear`, "jwt-A");
            assert.strictEqual(desbloqueo.status, 200);
            assert.strictEqual(desbloqueo.cuerpo.expulsionesCanceladas, 1);
            assert.strictEqual(sock.estado.llamadas.length, 0, "ninguna expulsión enviada en todo el recorrido");
        } finally {
            servidor.close();
        }
    });

    const fallidas = resultados.filter(r => !r.ok);
    console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas OK (simuladas: sin Supabase real ni WhatsApp real)`);
    if (fallidas.length) process.exitCode = 1;

}

main();
