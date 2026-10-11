// Supabase falso en memoria para las pruebas del control de inactividad.
// Persiste entre "reinicios" del proceso simulado (las pruebas vacían la
// caché de require de los módulos de inactividad, pero NO este almacén) y
// aplica las mismas restricciones únicas de la migración 022.

let secuencia = 0;

function crearAlmacen() {

    const tablas = {
        inactividad_miembros: [],
        inactividad_ejecuciones: [],
        inactividad_evaluaciones: [],
        eventos_bot: []
    };

    const conteo = { inserts: {}, updates: {} };

    // Devuelve un error 23505 si `fila` viola una restricción única.
    function violaUnica(tabla, fila) {

        if (tabla === "inactividad_miembros") {
            return tablas[tabla].some(f => f.usuario_id === fila.usuario_id && f.grupo_id === fila.grupo_id && f.usuario_global_id === fila.usuario_global_id);
        }

        if (tabla === "inactividad_ejecuciones" && fila.estado === "en_curso") {
            return tablas[tabla].some(f => f.usuario_id === fila.usuario_id && f.estado === "en_curso");
        }

        return false;

    }

    function conDefectos(tabla, fila) {

        const ahora = new Date().toISOString();
        const base = { id: `id-${++secuencia}`, ...fila };

        if (tabla === "inactividad_miembros") {
            return { seguimiento_desde: ahora, presente: true, ultima_compra_en: null, creado_en: ahora, actualizado_en: ahora, ...base };
        }

        if (tabla === "inactividad_ejecuciones") {
            return { estado: "en_curso", iniciado_en: ahora, resumen: {}, ...base };
        }

        return base;

    }

    function comparar(a, b) {
        const da = Date.parse(a);
        const db = Date.parse(b);
        if (!Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}/.test(String(a))) return da - db;
        return a < b ? -1 : a > b ? 1 : 0;
    }

    function cumpleCondicion(fila, cond) {

        const [col, op, ...resto] = cond.split(".");
        const valor = resto.join(".");

        if (op === "is" && valor === "null") return fila[col] == null;
        if (op === "eq") return String(fila[col]) === valor;
        if (op === "lt") return fila[col] != null && comparar(fila[col], valor) < 0;

        throw new Error(`fake: condición no soportada ${cond}`);

    }

    function from(tabla) {

        const q = { filtros: [], op: "select", payload: null, unico: null, devolver: false, orden: null, limite: null, rango: null };

        const b = {
            select() { if (q.op !== "select") q.devolver = true; return b; },
            insert(payload) { q.op = "insert"; q.payload = payload; return b; },
            update(payload) { q.op = "update"; q.payload = payload; return b; },
            delete() { q.op = "delete"; return b; },
            is(col, v) { q.filtros.push(f => (v === null ? f[col] == null : f[col] === v)); return b; },
            eq(col, v) { q.filtros.push(f => f[col] === v); return b; },
            lt(col, v) { q.filtros.push(f => f[col] != null && comparar(f[col], v) < 0); return b; },
            in(col, vs) { q.filtros.push(f => vs.includes(f[col])); return b; },
            or(expr) { const conds = expr.split(","); q.filtros.push(f => conds.some(c => cumpleCondicion(f, c))); return b; },
            order(col, { ascending = true } = {}) { q.orden = { col, ascending }; return b; },
            limit(n) { q.limite = n; return b; },
            range(a, z) { q.rango = [a, z]; return b; },
            single() { q.unico = "single"; return b; },
            maybeSingle() { q.unico = "maybe"; return b; },
            then(ok, ko) { return Promise.resolve().then(ejecutar).then(ok, ko); }
        };

        function ejecutar() {

            if (almacen.fallarTabla && almacen.fallarTabla === tabla) {
                return { data: null, error: { message: `fallo simulado en ${tabla}` } };
            }

            const filas = tablas[tabla] || (tablas[tabla] = []);

            if (q.op === "insert") {

                const nuevas = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(f => conDefectos(tabla, f));

                for (const n of nuevas) {
                    if (tabla === "inactividad_miembros" && almacen.usuariosInexistentes.has(n.usuario_global_id)) {
                        return { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
                    }
                    if (violaUnica(tabla, n)) return { data: null, error: { code: "23505", message: "duplicate key" } };
                }

                filas.push(...nuevas);
                conteo.inserts[tabla] = (conteo.inserts[tabla] || 0) + nuevas.length;

                const data = q.unico ? { ...nuevas[0] } : nuevas.map(n => ({ ...n }));

                return { data, error: null };

            }

            let resultado = filas.filter(f => q.filtros.every(fn => fn(f)));

            if (q.op === "delete") {
                tablas[tabla] = filas.filter(f => !resultado.includes(f));
                return { data: null, error: null };
            }

            if (q.op === "update") {

                for (const f of resultado) Object.assign(f, q.payload);
                conteo.updates[tabla] = (conteo.updates[tabla] || 0) + resultado.length;

            }

            if (q.orden) {
                const { col, ascending } = q.orden;
                resultado = [...resultado].sort((a, z) => (ascending ? 1 : -1) * comparar(a[col], z[col]));
            }

            if (q.rango) resultado = resultado.slice(q.rango[0], q.rango[1] + 1);
            if (q.limite != null) resultado = resultado.slice(0, q.limite);

            const copia = resultado.map(f => ({ ...f }));

            if (q.unico === "single") {
                return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 o varias filas" } };
            }

            if (q.unico === "maybe") return { data: copia[0] || null, error: null };

            return { data: copia, error: null };

        }

        return b;

    }

    const almacen = { tablas, conteo, from, fallarTabla: null, usuariosInexistentes: new Set() };

    return almacen;

}

module.exports = { crearAlmacen };
