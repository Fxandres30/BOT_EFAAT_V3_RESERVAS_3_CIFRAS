// ==========================================================================
// PRUEBAS — control de inactividad (15 días sin compra confirmada).
//
// Reales: configInactividad.js, inactividadRepo.js, evaluarMiembro.js,
// ejecutarControlInactividad.js, workerInactividad.js, extraerCandidatos
// (bloqueoParticipantesGrupo.js), confirmarPagoPorSticker -> registro de
// compra (vía inactividadRepo.registrarComprasDeFilas).
// Simulados: Supabase (almacén en memoria persistente entre "reinicios"),
// WhatsApp (groupMetadata / groupParticipantsUpdate) e identidad
// (resolverIdentidadExistente).
//
// NINGUNA prueba toca Supabase real ni WhatsApp real.
//
//     node backend/tests/inactividad/controlInactividad.test.js
// ==========================================================================

const assert = require("assert");
const path = require("path");
const { crearAlmacen } = require("./fakeSupabaseInactividad");

const RAIZ = path.resolve(__dirname, "../..");
const r = (p) => path.join(RAIZ, p);

function inyectar(ruta, exportsObj) {
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: exportsObj };
}

let almacen = crearAlmacen();

// El módulo lib/supabase.js se reemplaza por un proxy al almacén vigente.
inyectar(r("lib/supabase.js"), { from: (t) => almacen.from(t) });

const MODULOS = [
    "bot/funciones/inactividad/configInactividad.js",
    "bot/funciones/inactividad/inactividadRepo.js",
    "bot/funciones/inactividad/evaluarMiembro.js",
    "bot/funciones/inactividad/ejecutarControlInactividad.js",
    "bot/funciones/inactividad/workerInactividad.js"
];

// "Reinicio del proceso": se descarta todo el estado en memoria de los
// módulos de inactividad; el almacén (Supabase) se conserva.
function cargar() {
    for (const m of MODULOS) delete require.cache[r(m)];
    return {
        control: require(r("bot/funciones/inactividad/ejecutarControlInactividad.js")),
        repo: require(r("bot/funciones/inactividad/inactividadRepo.js")),
        worker: require(r("bot/funciones/inactividad/workerInactividad.js")),
        evaluar: require(r("bot/funciones/inactividad/evaluarMiembro.js")),
        config: require(r("bot/funciones/inactividad/configInactividad.js"))
    };
}

const { extraerCandidatos } = require(r("bot/funciones/bloqueo/bloqueoParticipantesGrupo.js"));

// ------------------------------------------------------------- escenario ---

const TENANT = "tenant-1";
const DIA = 24 * 3600 * 1000;
const T0 = new Date("2026-10-09T15:00:00Z"); // 10:00 en Bogotá
const hace = (dias) => new Date(T0.getTime() - dias * DIA);
const fechaBogota = (d) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const horaBogota = (d) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(11, 19);

// Personas: lid -> usuario_global_id. "conflicto" y "fantasma" no resuelven.
const PERSONAS = {
    bot: { lid: "900", tel: "573009999999", ug: null },
    owner: { lid: "901", tel: "573000000901", ug: "ug-owner" },
    admin: { lid: "902", tel: "573000000902", ug: "ug-admin" },
    reciente: { lid: "903", tel: "573000000903", ug: "ug-reciente" },
    vieja: { lid: "904", tel: "573000000904", ug: "ug-vieja" },
    nunca: { lid: "905", tel: "573000000905", ug: "ug-nunca" },
    soloReservo: { lid: "906", tel: "573000000906", ug: "ug-solo-reservo" },
    conflicto: { lid: "907", tel: "573000000907", ug: "CONFLICTO" },
    fantasma: { lid: "908", tel: "573000000908", ug: null },
    protegido: { lid: "909", tel: "573000000909", ug: "ug-protegido" },
    dosGrupos: { lid: "910", tel: "573000000910", ug: "ug-dos-grupos" },
    catorce: { lid: "911", tel: "573000000911", ug: "ug-catorce" },
    quince: { lid: "912", tel: "573000000912", ug: "ug-quince" }
};

function participante(nombre, admin = null) {
    const p = PERSONAS[nombre];
    return { id: `${p.lid}@lid`, phoneNumber: `${p.tel}@s.whatsapp.net`, admin };
}

const SOCK = {
    context: { usuarioId: TENANT, sessionId: "s1" },
    user: { id: `${PERSONAS.bot.tel}:5@s.whatsapp.net`, lid: `${PERSONAS.bot.lid}:5@lid` }
};

function filaTabla(numero, estado, persona, grupo, fecha) {
    return {
        numero, estado, usuario_id: TENANT, grupo_id: grupo,
        usuario_global_id: PERSONAS[persona].ug,
        fecha_pago: estado === "pagado" ? fechaBogota(fecha) : null,
        hora_pago: estado === "pagado" ? horaBogota(fecha) : null
    };
}

let metadatas;
let wa;

function escenarioBase() {

    almacen = crearAlmacen();

    almacen.tablas.eventos_bot.push(
        { grupo_id: "A@g.us", grupo_nombre: "Grupo A", tabla: "tabla_a", usuario_id: TENANT },
        { grupo_id: "B@g.us", grupo_nombre: "Grupo B", tabla: "tabla_b", usuario_id: TENANT },
        { grupo_id: "X@g.us", grupo_nombre: "Otro tenant", tabla: "tabla_x", usuario_id: "tenant-2" }
    );

    almacen.tablas.tabla_a = [
        filaTabla("01", "pagado", "reciente", "A@g.us", hace(3)),
        filaTabla("02", "pagado", "vieja", "A@g.us", hace(20)),
        filaTabla("03", "reservado", "soloReservo", "A@g.us", hace(20)),
        filaTabla("04", "pagado", "dosGrupos", "A@g.us", hace(2)),
        filaTabla("05", "pagado", "catorce", "A@g.us", hace(14)),
        filaTabla("06", "pagado", "quince", "A@g.us", hace(15)),
        { numero: "07", estado: "libre", usuario_id: TENANT }
    ];
    almacen.tablas.tabla_b = [];

    // dosGrupos está en B desde hace 20 días y nunca compró allí.
    almacen.tablas.inactividad_miembros.push({
        id: "seg-b-dos", usuario_id: TENANT, grupo_id: "B@g.us", usuario_global_id: "ug-dos-grupos",
        ultima_compra_en: null, seguimiento_desde: hace(20).toISOString(), presente: true
    });

    metadatas = {
        "A@g.us": {
            id: "A@g.us",
            owner: `${PERSONAS.owner.lid}@lid`,
            participants: [
                participante("bot", "admin"),
                participante("owner", "superadmin"),
                participante("admin", "admin"),
                participante("reciente"), participante("vieja"), participante("nunca"),
                participante("soloReservo"), participante("conflicto"), participante("fantasma"),
                participante("protegido"), participante("dosGrupos"), participante("catorce"), participante("quince"),
                { id: "", admin: null } // sin datos
            ]
        },
        "B@g.us": {
            id: "B@g.us",
            owner: `${PERSONAS.owner.lid}@lid`,
            participants: [participante("bot", "admin"), participante("owner", "superadmin"), participante("dosGrupos")]
        }
    };

    wa = { expulsiones: [], metadataLlamadas: 0, respuestaExpulsion: () => [{ status: "200" }], fallarMetadata: {} };

}

function deps() {
    return {
        groupMetadata: async (sock, grupoId) => {
            wa.metadataLlamadas++;
            if (wa.fallarMetadata[grupoId]) throw wa.fallarMetadata[grupoId];
            return JSON.parse(JSON.stringify(metadatas[grupoId]));
        },
        groupParticipantsUpdate: async (sock, grupoId, jids, accion) => {
            wa.expulsiones.push({ grupoId, jid: jids[0], accion });
            return wa.respuestaExpulsion(grupoId, jids[0]);
        },
        resolverIdentidadExistente: async ({ lid }) => {
            const plano = String(lid || "").split("@")[0].split(":")[0];
            const persona = Object.values(PERSONAS).find(p => p.lid === plano);
            if (!persona) return { conflicto: false, usuario: null };
            if (persona.ug === "CONFLICTO") return { conflicto: true, usuario: null };
            return { conflicto: false, usuario: persona.ug ? { id: persona.ug } : null };
        },
        extraerCandidatos,
        esCuentaIgnorada: () => false,
        dormir: async () => {},
        // Simula INACTIVIDAD_MODO=real + INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI.
        expulsionesConfirmadas: () => true
    };
}

function configBase(extra = {}) {
    return {
        modo: "simulacion", avisoModo: null, dias: 15, horaBogota: 10, intervaloMs: 3600000,
        horasEntreEjecuciones: 20, maxExpulsiones: 10, reintentos: 2, lockMinutos: 120,
        gruposPermitidos: [], protegidos: new Set([PERSONAS.protegido.tel]),
        ...extra
    };
}

async function correr({ ahora = T0, config = configBase(), mods = cargar() } = {}) {
    return mods.control.ejecutarControlInactividad({ sock: SOCK, config, ahora, deps: deps() });
}

function evaluacion(ug, grupo = "A@g.us", ejecucionId = null) {
    return almacen.tablas.inactividad_evaluaciones
        .filter(e => e.usuario_global_id === ug && e.grupo_id === grupo && (!ejecucionId || e.ejecucion_id === ejecucionId))
        .slice(-1)[0];
}

function evaluacionPorJid(jidParcial, grupo = "A@g.us") {
    return almacen.tablas.inactividad_evaluaciones.filter(e => e.grupo_id === grupo && String(e.miembro_jid || "").includes(jidParcial)).slice(-1)[0];
}

// ---------------------------------------------------------------- pruebas ---

const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

prueba("1. SIMULACIÓN: identifica candidatos y NUNCA llama a la expulsión de WhatsApp", async () => {
    escenarioBase();
    const informe = await correr();
    assert.strictEqual(informe.ok, true, JSON.stringify(informe));
    assert.strictEqual(informe.modo, "simulacion");
    assert.strictEqual(wa.expulsiones.length, 0);
    const ugs = informe.candidatos.map(c => c.usuarioGlobalId).sort();
    assert.deepStrictEqual(ugs, ["ug-dos-grupos", "ug-quince", "ug-vieja"]);
});

prueba("2. el informe trae por candidato: grupo, miembro, última compra, días, motivo y acción", async () => {
    escenarioBase();
    const informe = await correr();
    const c = informe.candidatos.find(x => x.usuarioGlobalId === "ug-vieja");
    assert.strictEqual(c.grupoId, "A@g.us");
    assert.strictEqual(c.grupoNombre, "Grupo A");
    assert.strictEqual(c.miembroJid, "904@lid");
    assert.strictEqual(new Date(c.ultimaCompra).toISOString(), hace(20).toISOString().replace(/\.\d{3}Z$/, ".000Z"));
    assert.strictEqual(c.diasSinCompra, 20);
    assert.ok(/sin_compra_confirmada_hace_20_dias/.test(c.motivo), c.motivo);
    assert.strictEqual(c.accion, "expulsar_simulado");
    assert.strictEqual(c.resultado, "simulado");
    const texto = cargar().control.formatearInforme(informe);
    assert.ok(/Grupo A/.test(texto) && /\*\*\*904@lid/.test(texto) && /20 días/.test(texto) && /expulsar_simulado/.test(texto), texto);
    // y queda en la bitácora persistente
    const e = evaluacion("ug-vieja");
    assert.strictEqual(e.decision, "candidato");
    assert.strictEqual(e.accion, "expulsar_simulado");
    assert.strictEqual(e.miembro_jid, "904@lid");
    assert.strictEqual(e.dias_sin_compra, 20);
});

prueba("3. compras recientes NO son candidatas (3 días, 14 días); 15 días SÍ", async () => {
    escenarioBase();
    await correr();
    assert.strictEqual(evaluacion("ug-reciente").decision, "conservar");
    assert.strictEqual(evaluacion("ug-reciente").motivo, "compra_reciente");
    assert.strictEqual(evaluacion("ug-catorce").decision, "conservar");
    assert.strictEqual(evaluacion("ug-catorce").dias_sin_compra, 14);
    assert.strictEqual(evaluacion("ug-quince").decision, "candidato");
    assert.strictEqual(evaluacion("ug-quince").dias_sin_compra, 15);
});

prueba("4. reserva pendiente, mensajes y pedidos de tabla NO cuentan como compra", async () => {
    escenarioBase();
    await correr();
    const seg = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-solo-reservo");
    assert.strictEqual(seg.ultima_compra_en, null, "una reserva sin pagar no es compra");
    // Su plazo empieza al observarlo: 15 días después, sin compras, es candidato.
    await correr({ ahora: new Date(T0.getTime() + 15 * DIA + 3600000) });
    assert.strictEqual(evaluacion("ug-solo-reservo").decision, "candidato");
    assert.ok(/sin_compras_confirmadas_en_15_dias/.test(evaluacion("ug-solo-reservo").motivo));
});

prueba("5. quien nunca compró tiene 15 días de gracia desde que se le observa (con fecha de cumplimiento)", async () => {
    escenarioBase();
    const informe = await correr();
    const e = evaluacion("ug-nunca");
    assert.strictEqual(e.decision, "conservar");
    assert.strictEqual(e.motivo, "seguimiento_iniciado");
    assert.strictEqual(e.cumple_plazo_en, new Date(T0.getTime() + 15 * DIA).toISOString());
    const proximos = informe.grupos.find(g => g.grupoId === "A@g.us").proximos;
    assert.ok(proximos.some(p => p.usuarioGlobalId === "ug-nunca"));
});

prueba("6. datos faltantes, identidad ambigua o no registrada -> omitidos (nunca candidatos)", async () => {
    escenarioBase();
    const informe = await correr();
    assert.strictEqual(evaluacionPorJid("907@lid").decision, "omitido");
    assert.strictEqual(evaluacionPorJid("907@lid").motivo, "identidad_ambigua");
    assert.strictEqual(evaluacionPorJid("908@lid").motivo, "identidad_no_registrada");
    const sinDatos = almacen.tablas.inactividad_evaluaciones.find(e => e.grupo_id === "A@g.us" && e.miembro_jid === null);
    assert.strictEqual(sinDatos.decision, "omitido");
    assert.strictEqual(sinDatos.motivo, "datos_insuficientes");
    assert.ok(!informe.candidatos.some(c => ["907@lid", "908@lid", null].includes(c.miembroJid)));
});

prueba("7. propietario, administradores, el propio bot y protegidos -> excluidos", async () => {
    escenarioBase();
    // Aunque tuvieran 30 días sin compra:
    for (const ug of ["ug-owner", "ug-admin", "ug-protegido"]) {
        almacen.tablas.inactividad_miembros.push({ id: `seg-${ug}`, usuario_id: TENANT, grupo_id: "A@g.us", usuario_global_id: ug, ultima_compra_en: null, seguimiento_desde: hace(30).toISOString(), presente: true });
    }
    await correr();
    assert.strictEqual(evaluacionPorJid("901@lid").motivo, "propietario_del_grupo");
    assert.strictEqual(evaluacionPorJid("902@lid").motivo, "administrador");
    assert.strictEqual(evaluacionPorJid("900@lid").motivo, "cuenta_del_bot");
    assert.strictEqual(evaluacionPorJid("909@lid").motivo, "protegido_por_configuracion");
    for (const j of ["900@lid", "901@lid", "902@lid", "909@lid"]) assert.strictEqual(evaluacionPorJid(j).decision, "excluido", j);
});

prueba("8. compra en un grupo, no en otro: conservar en A, candidato en B", async () => {
    escenarioBase();
    await correr();
    assert.strictEqual(evaluacion("ug-dos-grupos", "A@g.us").decision, "conservar");
    assert.strictEqual(evaluacion("ug-dos-grupos", "B@g.us").decision, "candidato");
    assert.strictEqual(evaluacion("ug-dos-grupos", "B@g.us").dias_sin_compra, 20);
});

prueba("9. solo grupos comerciales del tenant (nunca los de otro tenant) y filtro INACTIVIDAD_GRUPOS", async () => {
    escenarioBase();
    await correr();
    assert.ok(!almacen.tablas.inactividad_evaluaciones.some(e => e.grupo_id === "X@g.us"));
    escenarioBase();
    await correr({ config: configBase({ gruposPermitidos: ["B@g.us"] }) });
    assert.ok(almacen.tablas.inactividad_evaluaciones.every(e => e.grupo_id === "B@g.us"));
});

prueba("10. REAL confirmado: expulsa solo a los candidatos, tras releer el grupo", async () => {
    escenarioBase();
    const informe = await correr({ config: configBase({ modo: "real" }) });
    assert.deepStrictEqual(wa.expulsiones.map(e => `${e.grupoId}|${e.jid}|${e.accion}`).sort(),
        ["A@g.us|904@lid|remove", "A@g.us|912@lid|remove", "B@g.us|910@lid|remove"]);
    assert.strictEqual(informe.resumen.expulsados, 3);
    assert.strictEqual(evaluacion("ug-vieja").resultado, "expulsado");
    const seg = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-vieja");
    assert.strictEqual(seg.presente, false);
    assert.ok(seg.expulsado_en);
});

prueba("11. 'real' SIN INACTIVIDAD_CONFIRMAR_EXPULSIONES=SI se degrada a simulación", async () => {
    const { config } = cargar();
    const previo = { ...process.env };
    try {
        process.env.INACTIVIDAD_MODO = "real";
        delete process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES;
        assert.strictEqual(config.leerConfigInactividad().modo, "simulacion");
        process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES = "si";
        assert.strictEqual(config.leerConfigInactividad().modo, "real");
        delete process.env.INACTIVIDAD_MODO;
        delete process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES;
        assert.strictEqual(config.leerConfigInactividad().modo, "simulacion", "por defecto simulación");
        process.env.INACTIVIDAD_MODO = "desactivado";
        assert.strictEqual(config.leerConfigInactividad().modo, "desactivado");
    } finally {
        process.env = previo;
    }
});

prueba("12. verifica que siga en el grupo antes de expulsar: si ya salió, no se llama a WhatsApp", async () => {
    escenarioBase();
    const original = deps;
    let lecturas = 0;
    const d = deps();
    const gm = d.groupMetadata;
    d.groupMetadata = async (s, g) => {
        const m = await gm(s, g);
        if (g === "A@g.us" && ++lecturas === 2) m.participants = m.participants.filter(p => p.id !== "904@lid");
        return m;
    };
    const informe = await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.ok(!wa.expulsiones.some(e => e.jid === "904@lid"));
    assert.strictEqual(informe.candidatos.find(c => c.miembroJid === "904@lid").resultado, "ya_no_estaba");
    assert.ok(original);
});

prueba("13. bot sin permisos de admin -> no intenta expulsar, registra sin_permisos", async () => {
    escenarioBase();
    metadatas["A@g.us"].participants[0].admin = null;
    const informe = await correr({ config: configBase({ modo: "real" }) });
    assert.ok(!wa.expulsiones.some(e => e.grupoId === "A@g.us"));
    assert.strictEqual(informe.candidatos.find(c => c.miembroJid === "904@lid").resultado, "sin_permisos");
    assert.strictEqual(evaluacion("ug-vieja").resultado, "sin_permisos");
});

prueba("14. WhatsApp responde 403 -> sin_permisos sin reintentar; error transitorio -> reintenta y registra intentos", async () => {
    escenarioBase();
    wa.respuestaExpulsion = (g, jid) => (jid === "904@lid" ? [{ status: "403" }] : [{ status: "200" }]);
    let fallos = 0;
    const d = deps();
    const upd = d.groupParticipantsUpdate;
    d.groupParticipantsUpdate = async (s, g, jids, a) => {
        if (jids[0] === "912@lid" && fallos++ === 0) throw new Error("timeout");
        return upd(s, g, jids, a);
    };
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    const e403 = evaluacion("ug-vieja");
    assert.strictEqual(e403.resultado, "sin_permisos");
    assert.strictEqual(e403.intentos, 1);
    assert.strictEqual(wa.expulsiones.filter(e => e.jid === "904@lid").length, 1);
    const eTrans = evaluacion("ug-quince");
    assert.strictEqual(eTrans.resultado, "expulsado");
    assert.strictEqual(eTrans.intentos, 2);
});

prueba("15. error persistente -> agota reintentos y queda 'error' con el mensaje", async () => {
    escenarioBase();
    const d = deps();
    d.groupParticipantsUpdate = async () => { throw new Error("bad-request"); };
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real", reintentos: 2 }), ahora: T0, deps: d });
    const e = evaluacion("ug-vieja");
    assert.strictEqual(e.resultado, "error");
    assert.strictEqual(e.intentos, 3);
    assert.ok(/bad-request/.test(e.error));
});

prueba("16. desconexión durante las expulsiones -> se corta, ejecución 'fallida', bitácora guardada", async () => {
    escenarioBase();
    const d = deps();
    d.groupParticipantsUpdate = async () => { const e = new Error("SOCKET_NO_VIGENTE: cancelado"); e.code = "SOCKET_NO_VIGENTE"; throw e; };
    const informe = await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.strictEqual(informe.ok, false);
    assert.strictEqual(informe.estado, "fallida");
    const ej = almacen.tablas.inactividad_ejecuciones[0];
    assert.strictEqual(ej.estado, "fallida");
    assert.ok(/SOCKET_NO_VIGENTE/.test(ej.error));
    assert.strictEqual(evaluacion("ug-vieja").resultado, "error");
    assert.ok(/conexión perdida/.test(evaluacion("ug-vieja").error));
    // Grupo B nunca se procesó: nada se expulsó allí.
    assert.ok(!almacen.tablas.inactividad_evaluaciones.some(e => e.grupo_id === "B@g.us"));
});

prueba("17. groupMetadata falla en un grupo -> se registra error_grupo y los demás grupos continúan", async () => {
    escenarioBase();
    wa.fallarMetadata["A@g.us"] = new Error("rate-overlimit agotado");
    const informe = await correr();
    assert.strictEqual(informe.ok, true);
    const errA = almacen.tablas.inactividad_evaluaciones.find(e => e.grupo_id === "A@g.us");
    assert.strictEqual(errA.decision, "error_grupo");
    assert.ok(/rate-overlimit/.test(errA.error));
    assert.strictEqual(evaluacion("ug-dos-grupos", "B@g.us").decision, "candidato");
});

prueba("18. tope de expulsiones por ejecución", async () => {
    escenarioBase();
    const informe = await correr({ config: configBase({ modo: "real", maxExpulsiones: 1 }) });
    assert.strictEqual(wa.expulsiones.length, 1);
    assert.strictEqual(informe.candidatos.filter(c => c.resultado === "limite_alcanzado").length, 2);
});

prueba("19. EXCLUSIÓN MUTUA en el mismo proceso: dos ejecuciones simultáneas -> solo una corre", async () => {
    escenarioBase();
    const mods = cargar();
    const [a, b] = await Promise.all([correr({ mods }), correr({ mods })]);
    const motivos = [a, b].map(x => (x.ok ? "ok" : x.motivo)).sort();
    assert.deepStrictEqual(motivos, ["ok", "otra_ejecucion_en_curso"]);
    assert.strictEqual(almacen.tablas.inactividad_ejecuciones.length, 1);
});

prueba("20. EXCLUSIÓN MUTUA entre procesos (candado en BD) + candado vencido se libera", async () => {
    escenarioBase();
    almacen.tablas.inactividad_ejecuciones.push({ id: "otro-proceso", usuario_id: TENANT, modo: "real", estado: "en_curso", iniciado_en: new Date(T0.getTime() - 10 * 60000).toISOString() });
    const bloqueado = await correr({ config: configBase({ modo: "real" }) });
    assert.strictEqual(bloqueado.ok, false);
    assert.strictEqual(bloqueado.motivo, "otra_ejecucion_en_curso");
    assert.strictEqual(wa.expulsiones.length, 0);
    assert.strictEqual(wa.metadataLlamadas, 0);
    // 3 horas después (candado de 120 min vencido): se marca abandonado y corre.
    const despues = await correr({ ahora: new Date(T0.getTime() + 3 * 3600000) });
    assert.strictEqual(despues.ok, true);
    assert.strictEqual(almacen.tablas.inactividad_ejecuciones.find(e => e.id === "otro-proceso").estado, "abandonada");
});

prueba("21. PERSISTENCIA tras reinicio: seguimiento, compras y última ejecución sobreviven", async () => {
    escenarioBase();
    await correr({ mods: cargar() });
    const desde = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-nunca").seguimiento_desde;
    // "reinicio": módulos recargados, almacén intacto.
    const mods = cargar();
    assert.deepStrictEqual(await mods.worker.correspondeEjecutar({ usuarioId: TENANT, config: configBase(), ahora: new Date(T0.getTime() + 2 * 3600000) }),
        { ejecutar: false, motivo: "ya_ejecutado_recientemente" });
    await correr({ mods, ahora: new Date(T0.getTime() + 16 * DIA) });
    assert.strictEqual(almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-nunca").seguimiento_desde, desde, "no se reinicia el plazo al reiniciar");
    assert.strictEqual(evaluacion("ug-nunca").decision, "candidato");
    assert.strictEqual(evaluacion("ug-nunca").dias_sin_compra, 16);
});

prueba("22. una compra confirmada reinicia el contador; nunca lo retrocede una fecha vieja", async () => {
    escenarioBase();
    await correr();
    const { repo } = cargar();
    await repo.registrarComprasDeFilas({ usuarioId: TENANT, origen: "sticker_admin", filas: [
        { usuario_global_id: "ug-vieja", grupo_id: "A@g.us", fecha_pago: fechaBogota(T0), hora_pago: horaBogota(T0) }
    ] });
    await repo.registrarCompraConfirmada({ usuarioId: TENANT, grupoId: "A@g.us", usuarioGlobalId: "ug-vieja", fecha: hace(40), origen: "tabla_pagado" });
    const seg = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-vieja" && m.grupo_id === "A@g.us");
    assert.strictEqual(seg.ultima_compra_en, T0.toISOString());
    assert.strictEqual(seg.ultima_compra_origen, "sticker_admin");
    await correr({ ahora: new Date(T0.getTime() + 21 * 3600000) });
    assert.strictEqual(evaluacion("ug-vieja").decision, "conservar");
    assert.strictEqual(evaluacion("ug-vieja").motivo, "compra_reciente");
});

prueba("23. salió y volvió a entrar -> plazo nuevo (reingreso), aunque su última compra sea vieja", async () => {
    escenarioBase();
    await correr();
    const sinVieja = metadatas["A@g.us"].participants.filter(p => p.id !== "904@lid");
    const conVieja = metadatas["A@g.us"].participants;
    metadatas["A@g.us"].participants = sinVieja;
    await correr({ ahora: new Date(T0.getTime() + 21 * 3600000) });
    assert.strictEqual(almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-vieja").presente, false);
    metadatas["A@g.us"].participants = conVieja;
    await correr({ ahora: new Date(T0.getTime() + 2 * DIA) });
    assert.strictEqual(evaluacion("ug-vieja").decision, "conservar");
    assert.strictEqual(evaluacion("ug-vieja").motivo, "reingreso_al_grupo");
});

prueba("24. migración 022 sin aplicar -> no corre, no lanza, no toca WhatsApp", async () => {
    escenarioBase();
    const fromOriginal = almacen.from;
    almacen.from = (t) => (t.startsWith("inactividad_") ? { update: () => ({ eq: () => ({ eq: () => ({ lt: () => Promise.resolve({ error: { code: "42P01", message: "no existe" } }) }) }) }) } : fromOriginal(t));
    const informe = await correr();
    assert.strictEqual(informe.ok, false);
    assert.strictEqual(informe.motivo, "migracion_pendiente");
    assert.strictEqual(wa.metadataLlamadas, 0);
});

prueba("25. worker: respeta modo desactivado, hora de inicio y separación entre ejecuciones", async () => {
    escenarioBase();
    const { worker } = cargar();
    assert.strictEqual((await worker.correspondeEjecutar({ usuarioId: TENANT, config: configBase({ modo: "desactivado" }), ahora: T0 })).motivo, "desactivado");
    assert.strictEqual((await worker.correspondeEjecutar({ usuarioId: TENANT, config: configBase(), ahora: new Date("2026-10-09T12:00:00Z") })).motivo, "antes_de_la_hora");
    assert.deepStrictEqual(await worker.correspondeEjecutar({ usuarioId: TENANT, config: configBase(), ahora: T0 }), { ejecutar: true });
    const r1 = await worker.tick(SOCK, { ahora: T0, config: configBase(), deps: deps() });
    assert.strictEqual(r1.ejecutado, true);
    const r2 = await worker.tick(SOCK, { ahora: new Date(T0.getTime() + 3600000), config: configBase(), deps: deps() });
    assert.deepStrictEqual(r2, { ejecutado: false, motivo: "ya_ejecutado_recientemente" });
});

prueba("26. evaluarMiembro (pura): fecha en el futuro y fechas inválidas nunca son candidatas", async () => {
    const { evaluar } = cargar();
    const ok = { estado: "ok", usuarioGlobalId: "u" };
    assert.strictEqual(evaluar.evaluarMiembro({ identidad: ok, seguimiento: { ultima_compra_en: new Date(T0.getTime() + DIA).toISOString(), seguimiento_desde: hace(40).toISOString() }, ahora: T0 }).motivo, "fecha_en_el_futuro");
    assert.strictEqual(evaluar.evaluarMiembro({ identidad: ok, seguimiento: { ultima_compra_en: "basura", seguimiento_desde: null }, ahora: T0 }).decision, "omitido");
    assert.strictEqual(evaluar.evaluarMiembro({ identidad: ok, seguimiento: null, ahora: T0 }).motivo, "sin_registro_de_seguimiento");
});

prueba("27. fecha de pago de la tabla: hora de Bogotá, '24:xx' y sin fecha -> no se inventa", async () => {
    const { repo } = cargar();
    assert.strictEqual(repo.fechaCompraDeFila({ fecha_pago: "2026-10-01", hora_pago: "19:30:00" }).toISOString(), "2026-10-02T00:30:00.000Z");
    assert.strictEqual(repo.fechaCompraDeFila({ fecha_pago: "2026-10-01", hora_pago: "24:05:00" }).toISOString(), "2026-10-01T05:05:00.000Z");
    assert.strictEqual(repo.fechaCompraDeFila({ fecha_pago: null, hora_pago: "10:00:00" }), null);
});

prueba("28. integración: sticker de pago confirmado por admin -> registra la compra (grupo de la reserva)", async () => {
    escenarioBase();
    const filaPagada = { numero: "02", estado: "pagado", usuario_global_id: "ug-vieja", grupo_id: "A@g.us", fecha_pago: fechaBogota(T0), hora_pago: horaBogota(T0) };
    let resultadoPago = { estado: "confirmado", actualizadas: [filaPagada] };
    inyectar(r("bot/funciones/mensajes/extraerDatosSticker.js"), { extraerDatosSticker: () => ({ esSticker: true, fileSha256Hex: "abc", tieneCita: true, quotedParticipant: "904@lid" }) });
    inyectar(r("bot/funciones/admins/esAdministrador.js"), { esAdministrador: async () => ({ esAdministrador: true }) });
    inyectar(r("bot/funciones/usuarios/obtenerUsuarioGlobal.js"), { obtenerUsuarioGlobal: async () => ({ id: "ug-vieja" }), normalizarIdentificadoresDesdeJid: () => ({ telefono: null }) });
    inyectar(r("bot/funciones/eventos/consultarEvento.js"), { consultarEvento: async () => ({ id: "ev", activo: true, usuario_id: TENANT, grupo_id: "B@g.us", tabla: "tabla_a" }) });
    inyectar(r("bot/funciones/reservas/actualizarEvento.js"), { actualizarEvento: async () => {} });
    inyectar(r("bot/funciones/pagos/marcarReservasPagadasPorAdmin.js"), { marcarReservasPagadasPorAdmin: async () => resultadoPago });
    inyectar(r("bot/funciones/pagos/configuracionStickerPago.js"), { resolverStickerPago: async () => ({ hash: "abc", nivel: "grupo" }) });
    delete require.cache[r("bot/funciones/pagos/confirmarPagoPorSticker.js")];
    cargar();
    const { confirmarPagoPorSticker } = require(r("bot/funciones/pagos/confirmarPagoPorSticker.js"));
    const ctx = { chat: { esGrupo: true, remoteJid: "B@g.us", participante: "902@lid" }, message: { key: { participant: "902@lid" } }, session: { usuarioId: TENANT }, sock: {} };

    await confirmarPagoPorSticker(ctx);
    let seg = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-vieja" && m.grupo_id === "A@g.us");
    assert.ok(seg, "se creó/actualizó el registro en el grupo de la reserva (A), no en el del sticker (B)");
    assert.strictEqual(seg.ultima_compra_en, T0.toISOString());
    assert.strictEqual(seg.ultima_compra_origen, "sticker_admin");

    // "ya_pagado" / "sin_reservas" no registran nada.
    almacen.tablas.inactividad_miembros.length = 0;
    resultadoPago = { estado: "ya_pagado", actualizadas: [] };
    await confirmarPagoPorSticker(ctx);
    assert.strictEqual(almacen.tablas.inactividad_miembros.length, 0);

    // Si la tabla nueva falla, el pago no se ve afectado (no lanza).
    resultadoPago = { estado: "confirmado", actualizadas: [filaPagada] };
    almacen.fallarTabla = "inactividad_miembros";
    await confirmarPagoPorSticker(ctx);
    almacen.fallarTabla = null;
});

// ------------------------------------------- correcciones de la auditoría ---

prueba("29. REAL + falla la lectura de compras de una tabla -> expulsiones SUSPENDIDAS (nadie expulsado)", async () => {
    escenarioBase();
    almacen.fallarTabla = "tabla_a";
    const informe = await correr({ config: configBase({ modo: "real" }) });
    almacen.fallarTabla = null;
    assert.strictEqual(wa.expulsiones.length, 0);
    assert.strictEqual(informe.resumen.expulsionesSuspendidas, "sincronizacion_de_compras_incompleta");
    assert.ok(informe.candidatos.length > 0 && informe.candidatos.every(c => c.resultado === "suspendido"));
    assert.strictEqual(evaluacion("ug-dos-grupos", "B@g.us").resultado, "suspendido");
    // Sin poder leer sus compras, ug-vieja NO aparece como candidato: su
    // plazo empieza ahora (dirección segura).
    assert.strictEqual(evaluacion("ug-vieja").decision, "conservar");
});

prueba("30. REAL + una compra confirmada DURANTE la ejecución -> revalidación en BD, no se expulsa", async () => {
    escenarioBase();
    const d = deps();
    const gm = d.groupMetadata;
    let lecturasA = 0;
    d.groupMetadata = async (s, g) => {
        // 2ª lectura de A = verificación previa a expulsar: justo antes, el
        // trigger del pago registra una compra de ug-vieja.
        if (g === "A@g.us" && ++lecturasA === 2) {
            const seg = almacen.tablas.inactividad_miembros.find(m => m.usuario_global_id === "ug-vieja" && m.grupo_id === "A@g.us");
            seg.ultima_compra_en = T0.toISOString();
        }
        return gm(s, g);
    };
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.ok(!wa.expulsiones.some(e => e.jid === "904@lid"), "no expulsó a quien acaba de comprar");
    const e = evaluacion("ug-vieja");
    assert.strictEqual(e.decision, "conservar");
    assert.ok(/^revalidado:compra_reciente/.test(e.motivo), e.motivo);
    assert.ok(wa.expulsiones.some(x => x.jid === "912@lid"), "los demás candidatos sí");
});

prueba("31. la bitácora se escribe ANTES de expulsar ('pendiente') y se completa después", async () => {
    escenarioBase();
    const d = deps();
    const vistos = [];
    const upd = d.groupParticipantsUpdate;
    d.groupParticipantsUpdate = async (s, g, jids, a) => {
        vistos.push(almacen.tablas.inactividad_evaluaciones.find(e => e.miembro_jid === jids[0] && e.grupo_id === g)?.resultado);
        return upd(s, g, jids, a);
    };
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.deepStrictEqual(vistos, ["pendiente", "pendiente", "pendiente"]);
    assert.strictEqual(evaluacion("ug-vieja").resultado, "expulsado");
    assert.strictEqual(evaluacion("ug-vieja").intentos, 1);
});

prueba("32. identidad incompleta (solo LID, sin teléfono vinculado) -> omitido; con LID+teléfono en usuarios -> evaluable", async () => {
    escenarioBase();
    metadatas["A@g.us"].participants.push({ id: "950@lid", admin: null });
    const d = deps();
    d.resolverIdentidadExistente = async ({ lid }) => (String(lid).startsWith("950")
        ? { conflicto: false, usuario: { id: "ug-solo-lid", lid: "950@lid", telefono: null } }
        : deps().resolverIdentidadExistente({ lid }));
    almacen.tablas.inactividad_miembros.push({ id: "seg-solo-lid", usuario_id: TENANT, grupo_id: "A@g.us", usuario_global_id: "ug-solo-lid", ultima_compra_en: null, seguimiento_desde: hace(40).toISOString(), presente: true });
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase(), ahora: T0, deps: d });
    assert.strictEqual(evaluacion("ug-solo-lid").decision, "omitido");
    assert.strictEqual(evaluacion("ug-solo-lid").motivo, "identidad_incompleta");

    escenarioBase();
    metadatas["A@g.us"].participants.push({ id: "950@lid", admin: null });
    d.resolverIdentidadExistente = async ({ lid }) => (String(lid).startsWith("950")
        ? { conflicto: false, usuario: { id: "ug-solo-lid", lid: "950", telefono: "3009500000" } }
        : deps().resolverIdentidadExistente({ lid }));
    almacen.tablas.inactividad_miembros.push({ id: "seg-solo-lid", usuario_id: TENANT, grupo_id: "A@g.us", usuario_global_id: "ug-solo-lid", ultima_compra_en: null, seguimiento_desde: hace(40).toISOString(), presente: true });
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase(), ahora: T0, deps: d });
    assert.strictEqual(evaluacion("ug-solo-lid").decision, "candidato");
});

prueba("33. el bot pierde el rol de admin entre la evaluación y la expulsión -> no expulsa, sin_permisos", async () => {
    escenarioBase();
    const d = deps();
    const gm = d.groupMetadata;
    let lecturasA = 0;
    d.groupMetadata = async (s, g) => {
        const m = await gm(s, g);
        if (g === "A@g.us" && ++lecturasA === 2) m.participants[0].admin = null;
        return m;
    };
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.ok(!wa.expulsiones.some(e => e.grupoId === "A@g.us"));
    assert.strictEqual(evaluacion("ug-vieja").resultado, "sin_permisos");
});

prueba("34. un admin con registro de compras NO queda marcado como ausente", async () => {
    escenarioBase();
    almacen.tablas.inactividad_miembros.push({ id: "seg-admin", usuario_id: TENANT, grupo_id: "A@g.us", usuario_global_id: "ug-admin", ultima_compra_en: hace(2).toISOString(), seguimiento_desde: hace(2).toISOString(), presente: true });
    await correr();
    assert.strictEqual(almacen.tablas.inactividad_miembros.find(m => m.id === "seg-admin").presente, true);
});

prueba("35. revalidación imposible (lectura del seguimiento falla) -> NO expulsa", async () => {
    escenarioBase();
    const { control, repo } = cargar();
    const original = repo.obtenerSeguimiento;
    repo.obtenerSeguimiento = async () => ({ ok: false, error: "timeout de base de datos", fila: null });
    try {
        await control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: deps() });
    } finally {
        repo.obtenerSeguimiento = original;
    }
    assert.strictEqual(wa.expulsiones.length, 0);
    assert.ok(/revalidación fallida/.test(evaluacion("ug-vieja").error));
});

prueba("36. tiempo máximo agotado -> deja de expulsar ('tiempo_agotado'), para no solaparse con otra instancia", async () => {
    escenarioBase();
    await correr({ config: configBase({ modo: "real", lockMinutos: -1 }) });
    assert.strictEqual(wa.expulsiones.length, 0);
    assert.strictEqual(evaluacion("ug-vieja").resultado, "tiempo_agotado");
});

prueba("37. retención: purga la bitácora del tenant más vieja que N días (no la de otros tenants)", async () => {
    escenarioBase();
    almacen.tablas.inactividad_evaluaciones.push(
        { id: "vieja", usuario_id: TENANT, creado_en: hace(100).toISOString() },
        { id: "otro-tenant", usuario_id: "tenant-2", creado_en: hace(100).toISOString() },
        { id: "reciente", usuario_id: TENANT, creado_en: hace(10).toISOString() }
    );
    await correr({ config: configBase({ retencionDias: 90 }) });
    const ids = almacen.tablas.inactividad_evaluaciones.map(e => e.id);
    assert.ok(!ids.includes("vieja"));
    assert.ok(ids.includes("otro-tenant") && ids.includes("reciente"));
});

prueba("39. fila pagada de un usuario BORRADO (FK) -> no suspende las expulsiones para siempre", async () => {
    escenarioBase();
    almacen.tablas.tabla_a.push({ numero: "08", estado: "pagado", usuario_id: TENANT, grupo_id: "A@g.us", usuario_global_id: "ug-borrado", fecha_pago: fechaBogota(hace(1)), hora_pago: "10:00:00" });
    almacen.usuariosInexistentes.add("ug-borrado");
    const informe = await correr({ config: configBase({ modo: "real" }) });
    assert.strictEqual(informe.sincronizacion.sinReferencia, 1);
    assert.strictEqual(informe.resumen.expulsionesSuspendidas, null);
    assert.strictEqual(informe.resumen.expulsados, 3);
});

prueba("38. worker: iniciar dos veces la misma sesión (reconexión) deja UN solo intervalo", async () => {
    const { worker } = cargar();
    const previo = process.env.INACTIVIDAD_MODO;
    process.env.INACTIVIDAD_MODO = "simulacion";
    try {
        assert.strictEqual(worker.iniciarWorkerInactividad(SOCK), true);
        assert.strictEqual(worker.iniciarWorkerInactividad(SOCK), true);
        assert.strictEqual(worker.detenerWorkerInactividad("s1"), true);
        assert.strictEqual(worker.detenerWorkerInactividad("s1"), false, "no quedó un segundo intervalo vivo");
        process.env.INACTIVIDAD_MODO = "desactivado";
        assert.strictEqual(worker.iniciarWorkerInactividad(SOCK), false);
    } finally {
        if (previo === undefined) delete process.env.INACTIVIDAD_MODO; else process.env.INACTIVIDAD_MODO = previo;
    }
});

// ---------------------------------- "la simulación nunca expulsa" (fase) ---

prueba("40. config.modo='real' SIN confirmación en el entorno -> ninguna expulsión (barrera final)", async () => {
    escenarioBase();
    const d = deps();
    d.expulsionesConfirmadas = () => false;
    const informe = await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.strictEqual(wa.expulsiones.length, 0);
    assert.ok(informe.candidatos.length === 3 && informe.candidatos.every(c => c.resultado === "suspendido"));
    assert.ok(/no confirmadas en el entorno/.test(evaluacion("ug-vieja").error));
});

prueba("41. deps sin la función de confirmación -> falla cerrado (ninguna expulsión)", async () => {
    escenarioBase();
    const d = deps();
    delete d.expulsionesConfirmadas;
    await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "real" }), ahora: T0, deps: d });
    assert.strictEqual(wa.expulsiones.length, 0);
});

prueba("42. SIMULACIÓN con TODO a favor de expulsar (confirmación=true, bot admin) en 6 escenarios -> 0 expulsiones", async () => {
    const escenarios = [
        () => {},
        () => { wa.fallarMetadata["B@g.us"] = new Error("rate-overlimit"); },
        () => { almacen.fallarTabla = "tabla_a"; },
        () => { metadatas["A@g.us"].participants[0].admin = null; },
        () => { wa.respuestaExpulsion = () => [{ status: "500" }]; },
        () => { almacen.tablas.inactividad_miembros.forEach(m => { m.seguimiento_desde = hace(400).toISOString(); }); }
    ];
    for (const preparar of escenarios) {
        escenarioBase();
        preparar();
        const d = deps();
        const informe = await cargar().control.ejecutarControlInactividad({ sock: SOCK, config: configBase({ modo: "simulacion" }), ahora: new Date(T0.getTime() + 30 * DIA), deps: d });
        almacen.fallarTabla = null;
        assert.strictEqual(wa.expulsiones.length, 0, "la simulación expulsó");
        assert.ok(informe.candidatos.every(c => c.accion === "expulsar_simulado" && c.resultado === "simulado"));
    }
});

prueba("43. ESTÁTICA: el módulo tiene UNA sola llamada de expulsión y la barrera del entorno va justo antes", async () => {
    const fs = require("fs");
    const dir = r("bot/funciones/inactividad");
    const llamadas = [];
    for (const f of fs.readdirSync(dir)) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        const n = src.split("groupParticipantsUpdate(").length - 1;
        if (n) llamadas.push({ f, n });
    }
    assert.deepStrictEqual(llamadas, [{ f: "ejecutarControlInactividad.js", n: 1 }]);
    const src = fs.readFileSync(path.join(dir, "ejecutarControlInactividad.js"), "utf8");
    const iLlamada = src.indexOf("groupParticipantsUpdate(");
    const iBarrera = src.lastIndexOf("deps.expulsionesConfirmadas() !== true", iLlamada);
    assert.ok(iBarrera > 0 && iLlamada - iBarrera < 600, "la barrera precede a la llamada");
    // Y el worker de producción solo toma el modo del entorno.
    const worker = fs.readFileSync(path.join(dir, "workerInactividad.js"), "utf8");
    assert.ok(worker.includes("await tick(sock);"), "el intervalo llama tick(sock) sin config externa");
});

prueba("44. el modo por defecto del entorno es simulación; 'real' exige las DOS variables", async () => {
    const { config } = cargar();
    const previo = { ...process.env };
    try {
        for (const [modo, confirmar, esperado] of [
            [undefined, undefined, "simulacion"], ["simulacion", "SI", "simulacion"], ["real", undefined, "simulacion"],
            ["real", "NO", "simulacion"], ["real", "true", "simulacion"], ["REAL", "si", "real"], ["desactivado", "SI", "desactivado"]
        ]) {
            if (modo === undefined) delete process.env.INACTIVIDAD_MODO; else process.env.INACTIVIDAD_MODO = modo;
            if (confirmar === undefined) delete process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES; else process.env.INACTIVIDAD_CONFIRMAR_EXPULSIONES = confirmar;
            assert.strictEqual(config.leerConfigInactividad().modo, esperado, `${modo}/${confirmar}`);
        }
    } finally {
        process.env = previo;
    }
});

// ---------------------------------------------------------------- runner ---

(async () => {

    const salida = (t) => process.stdout.write(t + "\n");
    const originales = {};
    for (const m of ["log", "time", "timeEnd", "dir", "table", "error", "warn"]) {
        originales[m] = console[m];
        console[m] = () => {};
    }

    let ok = 0;
    let falla = 0;

    for (const { nombre, fn } of pruebas) {
        try {
            await fn();
            ok++;
            salida(`✅ ${nombre}`);
        } catch (err) {
            falla++;
            salida(`❌ ${nombre}`);
            salida(String(err && err.stack || err));
        }
    }

    Object.assign(console, originales);

    salida("\n============================");
    salida(`TOTAL: ${ok + falla}  ✅ PASA: ${ok}  ❌ FALLA: ${falla}`);
    salida("============================");

    process.exit(falla ? 1 : 0);

})();
