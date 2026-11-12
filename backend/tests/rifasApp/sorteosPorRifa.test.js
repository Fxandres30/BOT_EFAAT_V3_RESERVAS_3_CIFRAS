// ==========================================================================
// PRUEBAS — sorteos programados sobre el MOTOR ÚNICO DE RIFAS (12/11/2026).
//
// Reproduce el incidente real: un cliente con un sorteo de $1.000 CERRADO
// («Sinuano Día», 70 pagados + 2 reservados) y una rifa de $2.000 limpia. La
// vista previa del sorteo de $2.000 mostraba 72 ocupados (leía la cuadrícula
// antigua compartida) y el reinicio fallaba (030: UPDATE sin WHERE).
//
// Contra el SQL REAL: 032 + 050 + 030 + 051 + 054 (PGlite), con
// MOTOR_RIFAS=nuevo y los módulos reales del backend:
//   A. la rifa de $2.000 muestra 100 libres aunque la de $1.000 tenga 72;
//   B. cuatro grupos del mismo sorteo comparten la MISMA rifa y estados;
//   C. vista previa, imagen (publicar/Compartir/imprimir) y Reservas leen
//      exactamente lo mismo;
//   D. reiniciar con reservas de un sorteo activo, un pago en proceso o una
//      reserva anticipada: bloqueado y SIN modificar nada;
//   E. reiniciar una rifa con solo historia: nuevo ciclo, historial
//      archivado, bloqueos conservados, otras rifas y la cuadrícula antigua
//      intactas; una reserva entre revisión y aplicación lo impide (huella);
//   F. sin tabla_id (o con una rifa ajena / de otro precio) el backend y la
//      base rechazan el sorteo;
//   H. dos clientes con rifas del mismo precio: aislamiento total.
// (G, concurrencia real, en backend/tests/rifas/concurrenciaSorteoRifa.test.js)
//
//   PGLITE_MODULE=<carpeta>/node_modules/@electric-sql/pglite \
//     node backend/tests/rifasApp/sorteosPorRifa.test.js
// ==========================================================================

process.env.MOTOR_RIFAS = "nuevo";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { crearBase, cargarPGlite } = require("./pgliteSupabase");

const RAIZ = path.resolve(__dirname, "../..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, "supabase_migrations", p), "utf8");

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const G = ["120363000000000001@g.us", "120363000000000002@g.us", "120363000000000003@g.us", "120363000000000004@g.us"];

let ok = 0;
const paso = (n) => { ok++; console.log(`✅ ${n}`); };

// Tablas heredadas mínimas (no están en las migraciones del repo) con las
// columnas que exigen la 030 y la 051.
const BASE = `
    create table public.reservas_dos_cifras (
        id bigserial primary key, numero text, estado text default 'libre', usuario_id uuid,
        identidad_evento_real text, evento_id uuid, nombre_evento text, comprador text, contacto text,
        contacto_lower text, lib text, grupo_id text, grupo_nombre text, telefono_bot text,
        fecha_reserva date, hora_reserva text, fecha_pago date, hora_pago text, temporal_por text,
        bloqueado_hasta timestamptz, ip_reserva text, usuario_global_id uuid, nombre text, telefono text);
    create table public."5k_15k_reservas_2_cifras" (like public.reservas_dos_cifras including all);
    create table public.eventos_bot (
        id uuid primary key default gen_random_uuid(), usuario_id uuid, tabla text, activo boolean,
        estado text, cierre_estado text, identidad_evento_real text, nombre_evento text, valor text,
        grupo_id text, hora_fin text, hora_cierre text, fecha_evento date, cifras integer,
        cantidad_numeros integer, creado_en timestamptz default now());
    create table public.sorteos_programados (
        id uuid primary key default gen_random_uuid(), usuario_id uuid not null,
        estado text not null default 'borrador', tabla text, identidad_evento_real text,
        config jsonb not null default '{}'::jsonb, publicar_en timestamptz default now(),
        creado_en timestamptz default now());
    create table public.reservas_actividad (id uuid primary key default gen_random_uuid(), usuario_id uuid);
`;

(async () => {

    if (!cargarPGlite()) {
        console.log("⏭️  sin PGlite (PGLITE_MODULE): prueba omitida");
        process.exit(0);
    }

    const base = await crearBase({
        usuarios: [A, B],
        extra: [BASE, leer("030_reinicio_tabla_seguro.sql"), leer("051_vinculos_tabla_id.sql"), leer("054_sorteos_por_rifa.sql")]
    });
    const { pg } = base;
    const ruta = path.join(RAIZ, "lib/supabase.js");
    require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: base.client };

    const rifas = require(path.join(RAIZ, "rifas/repositorio.js"));
    const numerosSorteo = require(path.join(RAIZ, "rifas/numerosSorteo.js"));
    const { rifaParaSorteo } = require(path.join(RAIZ, "rifas/bot.js"));
    const tablaEvento = require(path.join(RAIZ, "automation/repo/tablaEvento.js"));
    const { revisarTabla } = require(path.join(RAIZ, "sorteos/disponibilidad.js"));
    const reinicioTabla = require(path.join(RAIZ, "sorteos/reinicioTabla.js"));
    const repo = require(path.join(RAIZ, "sorteos/repo.js"));
    const { estadoDelSorteo } = require(path.join(RAIZ, "bot/funciones/eventos/sorteoReal.js"));
    const { datosTablaImprimir } = require(path.join(RAIZ, "services/datosTablaImprimir.js"));
    const { huellaActual, huellaNumeros } = require(path.join(RAIZ, "sorteos/capturaProgramada.js"));
    const servicio = require(path.join(RAIZ, "sorteos/servicio.js"));

    const panelA = rifas.actor({ origen: "manual", operadorId: A });
    const panelB = rifas.actor({ origen: "manual", operadorId: B });
    const bot = rifas.actor({ origen: "bot" });

    const crear = async (u, precio, nombre, quien) => {
        const r = await rifas.crearRifa(u, { nombre, precio, cifras: 2 }, quien);
        assert.ok(r.ok && r.tabla_id, JSON.stringify(r));
        return r.tabla_id;
    };
    const R1 = await crear(A, 1000, "Tabla $1.000", panelA);
    const R2 = await crear(A, 2000, "Tabla $2.000", panelA);
    const R2b = await crear(A, 2000, "Tabla $2.000 (tarde)", panelA);
    const RD2 = await crear(A, 3000, "Tabla $3.000", panelA);
    const RD3 = await crear(A, 5000, "Tabla $5.000", panelA);
    const RB = await crear(B, 2000, "Tabla $2.000 de B", panelB);

    const evento = async (fila) => {
        const { rows } = await pg.query(
            `insert into public.eventos_bot (usuario_id, tabla, tabla_id, activo, estado, identidad_evento_real, nombre_evento, valor, grupo_id, cifras, cantidad_numeros)
             values ($1, 'reservas_dos_cifras', $2, $3, $4, $5, $6, $7, $8, 2, 100) returning *`,
            [fila.usuario, fila.tabla_id, fila.activo, fila.activo ? "activo" : "cerrado", fila.identidad, fila.nombre, String(fila.valor), fila.grupo || null]);
        return rows[0];
    };

    // Sinuano Día ($1.000), cerrado, con 72 ocupados (70 pagados + 2 reservados) en R1.
    const sinuano = await evento({ usuario: A, tabla_id: R1, activo: false, identidad: "sinuano-dia", nombre: "Sinuano Día", valor: 1000, grupo: G[0] });
    const setenta_y_dos = Array.from({ length: 72 }, (_, i) => i);
    let r = await rifas.reservar(A, R1, setenta_y_dos, { comprador: "Cliente", telefono: "573000000000", identidad_evento_real: "sinuano-dia", evento_id: sinuano.id, nombre_evento: "Sinuano Día" }, bot);
    assert.ok(r.ok, JSON.stringify(r));
    r = await rifas.pagar(A, R1, setenta_y_dos.slice(0, 70), {}, panelA);
    assert.ok(r.ok, JSON.stringify(r));

    // La cuadrícula ANTIGUA conserva los mismos 72 (como en producción).
    for (let n = 0; n < 100; n++) {
        const estado = n < 70 ? "pagado" : n < 72 ? "reservado" : "libre";
        await pg.query(`insert into public.reservas_dos_cifras (numero, estado, usuario_id, identidad_evento_real, evento_id) values ($1, $2, $3, $4, $5)`,
            [String(n).padStart(2, "0"), estado, A, estado === "libre" ? null : "sinuano-dia", estado === "libre" ? null : sinuano.id]);
    }

    const sorteo2000 = { id: "8af55145-b968-475d-9371-e41f003f78e9", usuario_id: A, tabla: "reservas_dos_cifras", tabla_id: R2, cifras: 2, cantidad_numeros: 100, identidad_evento_real: "antioquenita-dia", config: { valor: 2000, tabla: { reiniciar: true } } };

    // ---------------------------------------------------------------- A
    let t = await revisarTabla({ usuarioId: A, tabla: "reservas_dos_cifras", tablaId: R2, cifras: 2, cantidad: 100, identidad: "antioquenita-dia" });
    assert.deepStrictEqual(t.bloqueos, []);
    assert.strictEqual(t.resumen.libres, 100);
    assert.strictEqual(t.resumen.ocupadosOtroSorteo, 0);
    assert.ok(!t.avisos.some(a => /Sinuano/.test(a)), t.avisos.join(" | "));
    let img = await tablaEvento.obtenerNumeros(sorteo2000, A);
    assert.strictEqual(img.numerosDisponibles.length, 100);
    assert.strictEqual(img.numerosOcupados.length, 0);
    const img1000 = await tablaEvento.obtenerNumeros({ tabla_id: R1 }, A);
    assert.strictEqual(img1000.numerosOcupados.length, 72);
    assert.strictEqual(img1000.numerosPagados.length, 70);
    // Con el motor legado (vuelta atrás) se reproduce el fallo original: por
    // eso el legado solo existe tras el interruptor y nunca a la vez.
    process.env.MOTOR_RIFAS = "legado";
    const legado = await tablaEvento.obtenerNumeros(sorteo2000, A);
    assert.strictEqual(legado.numerosOcupados.length, 72);
    process.env.MOTOR_RIFAS = "nuevo";
    paso("A. rifa $2.000 limpia: vista previa e imagen 100 libres; los 72 de «Sinuano Día» ($1.000) solo en su rifa (el legado reproduce el fallo)");

    // ---------------------------------------------------------------- B
    for (const g of G.slice(0, 3)) assert.ok((await rifas.vincularGrupo(A, g, R2, {}, panelA)).ok);
    assert.ok((await rifas.vincularGrupo(A, G[3], R2b, {}, panelA)).ok);
    // Sin la rifa del sorteo, g4 resolvería OTRA rifa de $2.000: por eso la
    // del sorteo (sorteos_programados.tabla_id) manda en todos sus grupos.
    assert.strictEqual(await rifaParaSorteo({ usuarioId: A, grupoId: G[3], precio: 2000 }), R2b);
    const filasSorteo = [];
    for (const g of G) {
        const asignada = await rifaParaSorteo({ usuarioId: A, grupoId: g, precio: 2000, heredada: sorteo2000.tabla_id });
        assert.strictEqual(asignada, R2, `grupo ${g}`);
        filasSorteo.push(await evento({ usuario: A, tabla_id: asignada, activo: true, identidad: "antioquenita-dia", nombre: "Antioqueñita Día", valor: 2000, grupo: g }));
    }
    r = await rifas.reservar(A, R2, [5], { comprador: "Ana", telefono: "573111111111", grupo_id: G[0], identidad_evento_real: "antioquenita-dia", evento_id: filasSorteo[0].id }, bot);
    assert.ok(r.ok, JSON.stringify(r));
    const estados = await Promise.all(filasSorteo.map(f => estadoDelSorteo(f)));
    for (const e of estados) {
        assert.ok(e.ok, e.error);
        assert.strictEqual(e.reservados, 1);
        assert.strictEqual(e.libres, 99);
        assert.strictEqual(e.clasificacion.get("05"), "reservado");
    }
    paso("B. cuatro grupos (uno vinculado a otra rifa del mismo precio): todos usan la rifa del sorteo y ven los mismos estados");

    // ---------------------------------------------------------------- C
    const reservas = await rifas.leerNumeros(A, R2);
    const ocupadosReservas = reservas.filas.filter(f => f.estado !== "libre").map(f => f.numero);
    img = await tablaEvento.obtenerNumeros(sorteo2000, A);
    assert.deepStrictEqual(img.numerosOcupados, ocupadosReservas);
    assert.deepStrictEqual(img.numerosDisponibles, reservas.filas.filter(f => f.estado === "libre").map(f => f.numero));
    const porEvento = await datosTablaImprimir(A, 2000, filasSorteo[2].id);
    assert.ok(porEvento.ok, porEvento.error);
    assert.deepStrictEqual(porEvento.data.numerosOcupados, ocupadosReservas);
    const porRifa = await datosTablaImprimir(A, 2000, null, { tablaId: R2 });
    assert.deepStrictEqual(porRifa.data.numerosDisponibles, img.numerosDisponibles);
    const sinRifa = await datosTablaImprimir(A, 2000, null);
    assert.strictEqual(sinRifa.ok, false);
    assert.strictEqual(sinRifa.status, 409);
    const otroPrecio = await datosTablaImprimir(A, 1000, filasSorteo[0].id);
    assert.strictEqual(otroPrecio.ok, false);
    t = await revisarTabla({ usuarioId: A, tabla: "reservas_dos_cifras", tablaId: R2, cifras: 2, cantidad: 100, identidad: "antioquenita-dia" });
    assert.strictEqual(t.resumen.libres, 99);
    assert.strictEqual(await huellaActual(sorteo2000), huellaNumeros(img));
    const conteo = await repo.contarNumerosTabla(A, filasSorteo[1]);
    assert.deepStrictEqual([conteo.ok, conteo.reservados, conteo.pagados], [true, 1, 0]);
    paso("C. Reservas, vista previa, imagen (evento firmado o rifa) y conteos leen lo mismo; sin rifa o con otro precio no hay imagen");

    // ---------------------------------------------------------------- D
    const instantanea = async (tablaId) => {
        const { rows: n } = await pg.query(`select numero, estado, identidad_evento_real, version from public.numeros_rifa where tabla_id = $1 order by numero`, [tablaId]);
        const { rows: a } = await pg.query(`select count(*)::int as c from public.numeros_rifa_archivo where tabla_id = $1`, [tablaId]);
        const { rows: c } = await pg.query(`select ciclo from public.tablas_rifas where id = $1`, [tablaId]);
        return JSON.stringify({ n, a: a[0].c, c: c[0].ciclo });
    };
    const nuevoEnR2 = { ...sorteo2000, id: "11111111-0000-4000-8000-000000000001", identidad_evento_real: "otro-sorteo" };
    const antesD = await instantanea(R2);
    let rev = await reinicioTabla.revisarReinicio(A, nuevoEnR2);
    assert.ok(rev.ok, JSON.stringify(rev));
    assert.strictEqual(rev.data.posible, false);
    assert.ok(rev.data.bloqueos.some(b => /sorteo activo/.test(b)), rev.data.bloqueos.join(" | "));
    let ap = await reinicioTabla.aplicarReinicio(A, nuevoEnR2, rev.data.huella);
    assert.strictEqual(ap.ok, false);
    assert.strictEqual(ap.motivo, "reinicio_bloqueado");
    assert.strictEqual(await instantanea(R2), antesD);

    // Pago en proceso (sorteo cerrado): también protegido.
    const cerrado3 = await evento({ usuario: A, tabla_id: RD2, activo: false, identidad: "cerrado-3000", nombre: "Cerrado", valor: 3000 });
    assert.ok((await rifas.reservar(A, RD2, [1, 2], { telefono: "573222222222", identidad_evento_real: "cerrado-3000", evento_id: cerrado3.id }, bot)).ok);
    await pg.query(`update public.numeros_rifa set estado = 'en_proceso' where tabla_id = $1 and numero = 2`, [RD2]);
    const antesD2 = await instantanea(RD2);
    const sorteoRD2 = { id: null, usuario_id: A, tabla: "5k_15k_reservas_2_cifras", tabla_id: RD2, config: { valor: 3000 } };
    rev = await reinicioTabla.revisarReinicio(A, sorteoRD2);
    assert.strictEqual(rev.data.posible, false);
    assert.ok(rev.porSorteo.some(g => g.clase === "protegido_en_proceso"));
    ap = await reinicioTabla.aplicarReinicio(A, sorteoRD2, rev.data.huella);
    assert.strictEqual(ap.ok, false);
    assert.strictEqual(await instantanea(RD2), antesD2);

    // Reserva anticipada de un programado de ESA rifa sin publicar.
    await pg.query(`insert into public.sorteos_programados (usuario_id, estado, tabla, tabla_id, identidad_evento_real, config) values ($1, 'programado', '5k_15k_reservas_2_cifras', $2, 'anticipado-5000', '{"valor": 5000}')`, [A, RD3]);
    assert.ok((await rifas.reservar(A, RD3, [8], { telefono: "573333333333", identidad_evento_real: "anticipado-5000" }, panelA)).ok);
    const antesD3 = await instantanea(RD3);
    const { rows: [rd3] } = await pg.query(`select public.rifa_reiniciar_sorteo($1, $2, null, null, false) as r`, [A, RD3]);
    assert.strictEqual(rd3.r.ok, false);
    assert.ok(rd3.r.por_sorteo.some(g => g.clase === "protegido_anticipada"), JSON.stringify(rd3.r));
    const { rows: [rd3b] } = await pg.query(`select public.rifa_reiniciar_sorteo($1, $2, $3, null, true) as r`, [A, RD3, rd3.r.huella]);
    assert.strictEqual(rd3b.r.ok, false);
    assert.strictEqual(await instantanea(RD3), antesD3);
    paso("D. reinicio con sorteo activo, pago en proceso o reserva anticipada: bloqueado (backend y SQL) y ningún dato cambia");

    // ---------------------------------------------------------------- E
    assert.ok((await rifas.bloquear(A, R1, [99], panelA)).ok);
    const otrasAntes = [await instantanea(R2), await instantanea(R2b), await instantanea(RB)];
    const { rows: legadoAntes } = await pg.query(`select numero, estado, identidad_evento_real from public.reservas_dos_cifras order by numero`);
    const sorteoR1 = { id: "22222222-0000-4000-8000-000000000002", usuario_id: A, tabla: "reservas_dos_cifras", tabla_id: R1, config: { valor: 1000, tabla: { reiniciar: true } } };
    rev = await reinicioTabla.revisarReinicio(A, sorteoR1);
    assert.strictEqual(rev.data.posible, true, rev.data.bloqueos.join(" | "));
    assert.strictEqual(rev.data.liberables, 72);
    assert.strictEqual(rev.data.conservados, 1);
    // Una reserva entre la revisión y la aplicación: no se toca nada.
    assert.ok((await rifas.reservar(A, R1, [80], { telefono: "573444444444", identidad_evento_real: "sinuano-dia" }, bot)).ok);
    const antesE = await instantanea(R1);
    ap = await reinicioTabla.aplicarReinicio(A, sorteoR1, rev.data.huella);
    assert.deepStrictEqual([ap.ok, ap.motivo], [false, "tabla_cambio"]);
    assert.strictEqual(await instantanea(R1), antesE);
    assert.ok((await rifas.liberar(A, R1, [80], {}, panelA)).ok);
    rev = await reinicioTabla.revisarReinicio(A, sorteoR1);
    ap = await reinicioTabla.aplicarReinicio(A, sorteoR1, rev.data.huella);
    assert.ok(ap.ok, JSON.stringify(ap));
    assert.strictEqual(ap.data.archivados, 72);
    const { rows: tras } = await pg.query(`select estado, count(*)::int as n from public.numeros_rifa where tabla_id = $1 group by estado order by estado`, [R1]);
    assert.deepStrictEqual(tras, [{ estado: "bloqueado", n: 1 }, { estado: "libre", n: 99 }]);
    const { rows: archivo } = await pg.query(`select ciclo, estado, count(*)::int as n from public.numeros_rifa_archivo where tabla_id = $1 group by ciclo, estado order by estado`, [R1]);
    assert.deepStrictEqual(archivo, [{ ciclo: 1, estado: "pagado", n: 70 }, { ciclo: 1, estado: "reservado", n: 2 }]);
    const { rows: [ciclo] } = await pg.query(`select ciclo from public.tablas_rifas where id = $1`, [R1]);
    assert.strictEqual(ciclo.ciclo, 2);
    assert.deepStrictEqual([await instantanea(R2), await instantanea(R2b), await instantanea(RB)], otrasAntes);
    const { rows: legadoDespues } = await pg.query(`select numero, estado, identidad_evento_real from public.reservas_dos_cifras order by numero`);
    assert.deepStrictEqual(legadoDespues, legadoAntes);
    const { rows: [aud] } = await pg.query(`select count(*)::int as n from public.reservas_auditoria where tabla_id = $1 and accion = 'reiniciar'`, [R1]);
    assert.strictEqual(aud.n, 1);
    paso("E. reinicio de una rifa con solo historia: 72 archivados (ciclo 1), ciclo 2, bloqueo conservado, huella protege, otras rifas y la cuadrícula antigua intactas");

    // ---------------------------------------------------------------- F
    let v = await servicio._rifaDelSorteo(A, null, 2000);
    assert.strictEqual(v.error?.campo, "tabla_id");
    v = await servicio._rifaDelSorteo(A, RB, 2000);
    assert.match(v.error?.mensaje || "", /no existe en tu cuenta/);
    v = await servicio._rifaDelSorteo(A, R1, 2000);
    assert.strictEqual(v.error?.campo, "valor");
    v = await servicio._rifaDelSorteo(A, R2, 2000);
    assert.strictEqual(v.rifa?.id, R2);
    const insertar = (u, tablaId, valor, estado = "borrador") => pg.query(
        `insert into public.sorteos_programados (usuario_id, estado, tabla, tabla_id, identidad_evento_real, config) values ($1, $2, 'reservas_dos_cifras', $3, 'f', $4) returning id`,
        [u, estado, tablaId, JSON.stringify({ valor })]);
    const codigo = async (promesa) => { try { await promesa; return null; } catch (e) { return e.code; } };
    assert.strictEqual(await codigo(insertar(A, null, 2000)), "23502");
    assert.strictEqual(await codigo(insertar(A, RB, 2000)), "23503");
    assert.strictEqual(await codigo(insertar(A, R1, 2000)), "23514");
    const { rows: [valido] } = await insertar(A, R2, 2000);
    assert.strictEqual(await codigo(pg.query(`update public.sorteos_programados set tabla_id = null where id = $1`, [valido.id])), "23502");
    // Un borrador antiguo sin rifa: se puede cancelar, nunca programar.
    await pg.exec(`alter table public.sorteos_programados disable trigger sorteos_programados_con_rifa`);
    const { rows: [viejo] } = await pg.query(`insert into public.sorteos_programados (usuario_id, estado, tabla, config) values ($1, 'borrador', 'reservas_dos_cifras', '{"valor": 2000}') returning id`, [A]);
    await pg.exec(`alter table public.sorteos_programados enable trigger sorteos_programados_con_rifa`);
    assert.strictEqual(await codigo(pg.query(`update public.sorteos_programados set estado = 'programado' where id = $1`, [viejo.id])), "23502");
    assert.strictEqual(await codigo(pg.query(`update public.sorteos_programados set estado = 'cancelado' where id = $1`, [viejo.id])), null);
    paso("F. sin tabla_id, con una rifa ajena o de otro precio: el backend lo rechaza y la base también (054); un borrador viejo sin rifa solo se cancela");

    // ---------------------------------------------------------------- H
    assert.ok((await rifas.reservar(B, RB, [5, 6], { telefono: "573555555555", identidad_evento_real: "sorteo-b" }, bot)).ok);
    const deA = await tablaEvento.obtenerNumeros(sorteo2000, A);
    assert.deepStrictEqual(deA.numerosOcupados, ["05"]);
    const deB = await tablaEvento.obtenerNumeros({ tabla_id: RB }, B);
    assert.deepStrictEqual(deB.numerosOcupados, ["05", "06"]);
    await assert.rejects(() => tablaEvento.obtenerNumeros({ tabla_id: R2 }, B), (e) => e.code === "rifa_no_encontrada");
    const ajeno = await reinicioTabla.revisarReinicio(B, { ...sorteo2000, usuario_id: B });
    assert.deepStrictEqual([ajeno.ok, ajeno.motivo], [false, "rifa_no_encontrada"]);
    const cambioAjeno = await base.client.rpc("rifa_cambiar_identidad", { p_usuario: B, p_tabla: R2, p_anterior: "antioquenita-dia", p_nueva: "x", p_actor: { origen: "manual" } });
    assert.strictEqual(cambioAjeno.data.motivo, "rifa_no_encontrada");
    const cuentaB = await repo.contarNumerosTabla(B, { tabla_id: RB });
    assert.deepStrictEqual([cuentaB.reservados, cuentaB.pagados], [2, 0]);
    const sinRifaCuenta = await repo.contarNumerosTabla(A, { tabla: "reservas_dos_cifras" });
    assert.strictEqual(sinRifaCuenta.ok, false);
    paso("H. dos clientes con rifas de $2.000: números, conteos, imagen y reinicio aislados; sin rifa no se cuenta (nunca «0»)");

    // ---------------------------------------- corrección de identidad en la rifa
    const cambio = await base.client.rpc("rifa_cambiar_identidad", { p_usuario: A, p_tabla: R2, p_anterior: "antioquenita-dia", p_nueva: "antioquenita-corregida", p_nombre_evento: "Antioqueñita Noche", p_actor: { origen: "manual", operador_id: A } });
    assert.deepStrictEqual([cambio.data.ok, cambio.data.cambiados], [true, 1]);
    const { rows: [n5] } = await pg.query(`select identidad_evento_real, nombre_evento from public.numeros_rifa where tabla_id = $1 and numero = 5`, [R2]);
    assert.deepStrictEqual(n5, { identidad_evento_real: "antioquenita-corregida", nombre_evento: "Antioqueñita Noche" });
    paso("Corregir un sorteo activo: sus reservas pasan a la identidad nueva EN SU RIFA (auditado), nada de la cuadrícula antigua");

    console.log(`\n${ok} grupos de comprobaciones correctos.`);
    process.exit(0);

})().catch((e) => {
    console.error("❌", e);
    process.exit(1);
});
