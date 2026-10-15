// ==========================================================================
// PRUEBAS — identidad canónica del cliente entre LID, teléfono y la
// asociación de Baileys (signalRepository.lidMapping).
//
// Módulos REALES: middleware/obtenerUsuario.js, obtenerUsuarioGlobal.js,
// resolverIdentidadMensaje.js, reservarNumeros.js, validarReservas.js,
// consultarMisNumeros.js, agregarTelefonoContacto.js (panel) y
// marcarReservasPagadasPorAdmin.js. Simulados: Supabase (en memoria) y el
// socket de Baileys (solo su lidMapping). Datos ficticios.
//
//     node backend/tests/identidad/identidadCanonica.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

// ------------------------------------------------- base en memoria ---
let tablas;
let secuencia = 0;

function condicionOr(expr) {
    const conds = String(expr).split(",").map(c => {
        const [col, op, ...resto] = c.split(".");
        const val = resto.join(".");
        if (op === "eq") return f => String(f[col]) === val;
        if (op === "is" && val === "null") return f => f[col] == null;
        return () => false;
    });
    return f => conds.some(fn => fn(f));
}

const UNICAS = { usuarios: ["lid", "telefono"] };

const fakeSupabase = {
    from(tabla) {
        const q = { op: "select", filtros: [], payload: null };
        const b = {
            select() { if (q.op !== "select") q.devolver = true; return b; },
            order() { return b; },
            limit(n) { q.limite = n; return b; },
            eq(c, v) { q.filtros.push(f => f[c] === v); return b; },
            neq(c, v) { q.filtros.push(f => f[c] !== v); return b; },
            in(c, vs) { q.filtros.push(f => vs.includes(f[c])); return b; },
            or(e) { q.filtros.push(condicionOr(e)); return b; },
            insert(p) { q.op = "insert"; q.payload = p; return b; },
            upsert(p) { q.op = "upsert"; q.payload = p; return b; },
            update(p) { q.op = "update"; q.payload = p; return b; },
            single() { q.unico = true; return b; },
            maybeSingle() { q.unico = true; return b; },
            then(ok, ko) {
                const filas = tablas[tabla] || (tablas[tabla] = []);
                let res;
                if (q.op === "insert" || q.op === "upsert") {
                    const nuevas = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(p => ({ id: `${tabla}-${++secuencia}`, ...p }));
                    for (const n of nuevas) {
                        for (const c of UNICAS[tabla] || []) {
                            if (n[c] && filas.some(f => f[c] === n[c])) {
                                return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }).then(ok, ko);
                            }
                        }
                    }
                    filas.push(...nuevas);
                    res = { data: q.unico ? { ...nuevas[0] } : nuevas.map(f => ({ ...f })), error: null };
                } else {
                    let sel = filas.filter(f => q.filtros.every(fn => fn(f)));
                    if (q.op === "update") sel.forEach(f => Object.assign(f, q.payload));
                    if (q.limite) sel = sel.slice(0, q.limite);
                    const copia = sel.map(f => ({ ...f }));
                    res = { data: q.unico ? copia[0] || null : (q.op === "update" && !q.devolver ? null : copia), error: null };
                }
                return Promise.resolve(res).then(ok, ko);
            }
        };
        return b;
    }
};

require.cache[r("lib/supabase.js")] = { id: r("lib/supabase.js"), filename: r("lib/supabase.js"), loaded: true, exports: fakeSupabase };

const ugMod = require(r("bot/funciones/usuarios/obtenerUsuarioGlobal.js"));
const obtenerUsuario = require(r("bot/middleware/obtenerUsuario.js"));
const { reservarNumeros } = require(r("bot/funciones/reservas/reservarNumeros.js"));
const { validarReservas } = require(r("bot/funciones/reservas/validarReservas.js"));
const { consultarMisNumeros } = require(r("bot/funciones/consultas/consultarMisNumeros.js"));
const { agregarTelefonoContacto } = require(r("bot/funciones/usuarios/agregarTelefonoContacto.js"));
const { marcarReservasPagadasPorAdmin } = require(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"));

const contingencias = [];
ugMod.registrarContingenciaIdentidad = (tipo, detalle) => contingencias.push({ tipo, detalle });

const GRUPO = "120000000000000001@g.us";
const EVENTO = { id: "ev-1", tabla: "t", cifras: 2, usuario_id: "tenant-1", identidad_evento_real: "S1", grupo_id: GRUPO, grupo_nombre: "Grupo", nombre_evento: "Sorteo" };

// Identidades ficticias (formato real de WhatsApp).
const ANA = { lid: "111111111111111@lid", pn: "573000000001@s.whatsapp.net", tel: "3000000001" };
const BETO = { lid: "222222222222222@lid", pn: "573000000002@s.whatsapp.net", tel: "3000000002" };

// Socket simulado: solo la asociación LID <-> teléfono que conoce Baileys.
function socket(pares = []) {
    const lidAPn = new Map(pares.map(([lid, pn]) => [lid, pn.replace("@", ":0@")]));
    const pnALid = new Map(pares.map(([lid, pn]) => [pn, lid]));
    return {
        context: { usuarioId: "tenant-1" },
        signalRepository: { lidMapping: {
            getPNForLID: async (lid) => lidAPn.get(lid) || null,
            getLIDForPN: async (pn) => pnALid.get(pn) || null
        } }
    };
}

function reiniciar() {
    tablas = {
        usuarios: [], contactos_tenant: [], reservas_actividad: [],
        t: Array.from({ length: 100 }, (_, i) => ({ numero: String(i).padStart(2, "0"), estado: "libre", usuario_id: "tenant-1", identidad_evento_real: null, usuario_global_id: null, lid: null, telefono: null, contacto: null, nombre: null }))
    };
    contingencias.length = 0;
}

// Llega un mensaje al grupo -> ctx.usuario, por el middleware real.
function mensaje({ participant, participantAlt, pushName = "Cliente", sock = null }) {
    const key = { remoteJid: GRUPO, id: `M${++secuencia}`, fromMe: false, participant, ...(participantAlt ? { participantAlt } : {}) };
    return obtenerUsuario({ chat: { remoteJid: GRUPO, esGrupo: true }, message: { key, pushName }, session: { usuarioId: "tenant-1" }, sock });
}

const reservar = (usuario, numeros) => reservarNumeros({ evento: EVENTO, numeros, usuario, comprador: usuario.nombre, contacto: usuario.telefono, lib: usuario.lid });
const mios = async (usuario) => (await consultarMisNumeros({ evento: EVENTO, usuario })).sort();
const fila = (n) => tablas.t.find(f => f.numero === n);

const pruebas = [];
const prueba = (n, fn) => pruebas.push({ n, fn });

prueba("1. reserva con LID; consulta con el TELÉFONO asociado (Baileys) → mismo cliente, sus números, sin duplicar", async () => {
    reiniciar();
    const sock = socket([[ANA.lid, ANA.pn]]);
    const conLid = await mensaje({ participant: ANA.lid, sock });
    await reservar(conLid, ["23", "45"]);
    const conTelefono = await mensaje({ participant: ANA.pn, sock });
    assert.strictEqual(conTelefono.id, conLid.id);
    assert.deepStrictEqual(await mios(conTelefono), ["23", "45"]);
    assert.strictEqual(tablas.usuarios.length, 1, "no se creó otra persona");
});

prueba("2. reserva con TELÉFONO; consulta con el LID asociado (Baileys) → mismo cliente", async () => {
    reiniciar();
    const sock = socket([[ANA.lid, ANA.pn]]);
    const conTelefono = await mensaje({ participant: ANA.pn, sock });
    await reservar(conTelefono, ["07"]);
    const conLid = await mensaje({ participant: ANA.lid, sock });
    assert.strictEqual(conLid.id, conTelefono.id);
    assert.deepStrictEqual(await mios(conLid), ["07"]);
    assert.strictEqual(tablas.usuarios.length, 1);
});

prueba("3. reserva con LID; el admin guarda el teléfono en el perfil (panel); consulta con teléfono SIN Baileys → encuentra sus reservas", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid });
    await reservar(ana, ["12"]);
    const r1 = await agregarTelefonoContacto({ contactoId: ana.id, telefono: ANA.tel });
    assert.ok(r1.ok, JSON.stringify(r1));
    const conTelefono = await mensaje({ participant: ANA.pn });   // sin socket: sin asociación de Baileys
    assert.strictEqual(conTelefono.id, ana.id);
    assert.deepStrictEqual(await mios(conTelefono), ["12"]);
    assert.strictEqual(tablas.usuarios.length, 1);
});

prueba("4. luego llegan AMBOS identificadores en un mensaje → mismo cliente; se completa su perfil; nada duplicado", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid });
    await reservar(ana, ["30"]);
    const ambos = await mensaje({ participant: ANA.lid, participantAlt: ANA.pn });
    assert.strictEqual(ambos.id, ana.id);
    assert.strictEqual(tablas.usuarios[0].telefono, ANA.tel, "teléfono del propio mensaje (verificado por WhatsApp)");
    assert.deepStrictEqual(await mios(await mensaje({ participant: ANA.pn })), ["30"]);
    assert.strictEqual(tablas.usuarios.length, 1);
});

prueba("4b. la asociación de Baileys solo BUSCA: no escribe teléfonos en el perfil", async () => {
    reiniciar();
    const sock = socket([[ANA.lid, ANA.pn]]);
    await mensaje({ participant: ANA.lid, sock });
    assert.strictEqual(tablas.usuarios[0].telefono, null);
});

prueba("5. dos clientes distintos con el MISMO nombre visible → personas distintas; cada uno ve solo lo suyo", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid, pushName: "Cliente" });
    const beto = await mensaje({ participant: BETO.lid, pushName: "Cliente" });
    assert.notStrictEqual(ana.id, beto.id);
    await reservar(ana, ["01"]);
    await reservar(beto, ["02"]);
    assert.deepStrictEqual([await mios(ana), await mios(beto)], [["01"], ["02"]]);
});

prueba("6. el teléfono de Ana aparece por error en una reserva de Beto → Ana NO la ve ni la toma como suya", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid, participantAlt: ANA.pn });
    const beto = await mensaje({ participant: BETO.lid });
    await reservar(beto, ["65"]);
    Object.assign(fila("65"), { telefono: ANA.tel, contacto: ANA.tel });   // edición externa errónea
    assert.deepStrictEqual(await mios(ana), []);
    assert.deepStrictEqual(await mios(beto), ["65"]);
    assert.strictEqual(validarReservas([fila("65")], ana).yaSonMios.length, 0);
});

prueba("7. reservas antiguas sin usuario_global_id: por LID; por teléfono solo si la fila no tiene LID; nunca la de otro LID", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid, participantAlt: ANA.pn });
    const beto = await mensaje({ participant: BETO.lid });
    Object.assign(fila("50"), { estado: "reservado", lid: ANA.lid });
    Object.assign(fila("51"), { estado: "reservado", telefono: ANA.tel, contacto: ANA.tel });
    Object.assign(fila("52"), { estado: "pagado", lid: BETO.lid, telefono: ANA.tel, contacto: ANA.tel });   // caso real 86
    assert.deepStrictEqual(await mios(ana), ["50", "51"]);
    assert.deepStrictEqual(await mios(beto), ["52"]);
});

prueba("8. pago por sticker citando al cliente con su identidad ALTERNATIVA → paga sus reservas; sin asociación no crea a nadie", async () => {
    reiniciar();
    const sock = socket([[ANA.lid, ANA.pn]]);
    const ana = await mensaje({ participant: ANA.lid, sock });
    await reservar(ana, ["70"]);
    const citado = await ugMod.obtenerUsuarioGlobal({ jid: ANA.pn, nombre: null, sock, crear: false });
    assert.strictEqual(citado.id, ana.id);
    const pago = await marcarReservasPagadasPorAdmin({ evento: EVENTO, usuario: citado, realizadoPor: "admin@lid" });
    assert.strictEqual(pago.estado, "confirmado");
    assert.strictEqual(fila("70").estado, "pagado");
    const desconocido = await ugMod.obtenerUsuarioGlobal({ jid: BETO.pn, nombre: null, sock, crear: false });
    assert.strictEqual(desconocido, null);
    assert.strictEqual(tablas.usuarios.length, 1, "el sticker no crea personas");
});

prueba("9. asociación contradictoria: LID→X y teléfono→Y en el mismo mensaje → no se une, no se modifica nada (null)", async () => {
    reiniciar();
    const x = await mensaje({ participant: ANA.lid });
    const y = await mensaje({ participant: BETO.pn });
    const antes = JSON.stringify(tablas.usuarios);
    const r9 = await mensaje({ participant: ANA.lid, participantAlt: BETO.pn });
    assert.strictEqual(r9, null);
    assert.strictEqual(JSON.stringify(tablas.usuarios), antes);
    assert.notStrictEqual(x.id, y.id);
});

prueba("9b. si el conflicto lo provoca SOLO la asociación de Baileys → se atiende con lo que trajo el mensaje (sin unir) y queda registrado", async () => {
    reiniciar();
    const x = await mensaje({ participant: ANA.lid });            // persona con LID
    await mensaje({ participant: ANA.pn });                       // otra fila previa solo con teléfono (sin asociación entonces)
    const sock = socket([[ANA.lid, ANA.pn]]);
    const ahora = await mensaje({ participant: ANA.lid, sock });
    assert.strictEqual(ahora.id, x.id);
    assert.ok(contingencias.some(c => c.tipo === "ASOCIACION_BAILEYS_EN_CONFLICTO"));
    assert.strictEqual(tablas.usuarios.length, 2, "no se unen sin la tabla de identidades");
});

prueba("10. ningún cliente consulta, paga ni reserva encima de las reservas de otro", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid, participantAlt: ANA.pn });
    const beto = await mensaje({ participant: BETO.lid, participantAlt: BETO.pn });
    await reservar(ana, ["88"]);
    assert.deepStrictEqual(await mios(beto), []);
    const pago = await marcarReservasPagadasPorAdmin({ evento: EVENTO, usuario: beto, realizadoPor: "admin@lid" });
    assert.notStrictEqual(pago.estado, "confirmado");
    assert.strictEqual(fila("88").estado, "reservado");
    assert.deepStrictEqual(await reservar(beto, ["88"]), [], "no puede reservar un número ocupado");
    assert.strictEqual(fila("88").usuario_global_id, ana.id);
});

prueba("solo LID / sin teléfono: reservar y consultar funciona siempre con el LID", async () => {
    reiniciar();
    const ana = await mensaje({ participant: ANA.lid });
    await reservar(ana, ["05"]);
    assert.strictEqual(ana.telefono, null);
    assert.deepStrictEqual(await mios(await mensaje({ participant: ANA.lid })), ["05"]);
});

prueba("identidad desconocida (sin LID ni teléfono) → null, no crea nada", async () => {
    reiniciar();
    assert.strictEqual(await mensaje({ participant: undefined }), null);
    assert.strictEqual(tablas.usuarios.length, 0);
});

(async () => {
    let ok = 0, falla = 0;
    const log = console.log, warn = console.warn, err = console.error, dir = console.dir;
    for (const { n, fn } of pruebas) {
        console.log = console.warn = console.error = console.dir = () => {};
        let error = null;
        try { await fn(); } catch (e) { error = e; }
        console.log = log; console.warn = warn; console.error = err; console.dir = dir;
        if (error) { falla++; console.log(`❌ ${n}`); console.log(String(error && error.stack || error)); }
        else { ok++; console.log(`✅ ${n}`); }
    }
    console.log(`\n============================\nTOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}\n============================`);
    process.exit(falla ? 1 : 0);
})();
