// Supabase falso en memoria para las pruebas de sorteos programados.
// Aplica las restricciones únicas reales (migraciones 006 y 024) y simula
// supabase.auth.getUser(token) para probar la autenticación por sesión.

let secuencia = 0;

const UNICAS = {
    automation_actions: [["clave_idempotencia"]],
    sorteos_programados_grupos: [["sorteo_id", "grupo_id"]],
    plantillas_sorteo: [["usuario_id", "nombre"]],
    // Índice parcial (026): se ignora si alguna columna es null.
    loterias_catalogo: [["usuario_id", "nombre", "modalidad"], ["usuario_id", "origen_global_id"]],
    loterias_catalogo_ofrecidas: [["usuario_id", "global_id"]],
    loterias_catalogo_global: [["clave"]]
};

const DEFECTOS = {
    automation_actions: () => ({ estado: "en_progreso", ejecutado_en: new Date().toISOString(), detalle: {} }),
    sorteos_programados_grupos: () => ({ estado: "pendiente", intentos: 0, reintentos_manuales: 0 }),
    cuentas_pago: () => ({ activa: true, tipo: "otro" }),
    plantillas_sorteo: () => ({ activa: true }),
    loterias_catalogo: () => ({ modalidad: "", categoria: "chance", dias: [], hora: null, horas_por_dia: {}, regla_festivo: "sin_regla", hora_festivo: null, notas: null, activo: true })
};

function crearFake() {

    const tablas = {};
    const tokens = {};
    const control = { fallarTabla: null, llamadas: [], tablasInexistentes: new Set() };

    function comparar(a, b) {
        if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1;
        return a < b ? -1 : a > b ? 1 : 0;
    }

    function from(tabla) {

        const q = { op: "select", payload: null, filtros: [], orden: null, limite: null, unico: null, devolver: false };

        const b = {
            select(_columnas, opciones) {
                if (q.op !== "select") q.devolver = true;
                if (opciones?.count) q.contar = true;
                if (opciones?.head) q.cabecera = true;
                return b;
            },
            insert(x) { q.op = "insert"; q.payload = x; return b; },
            // upsert(filas, { onConflict: "a,b", ignoreDuplicates }) como supabase-js.
            upsert(x, opciones = {}) {
                q.op = "upsert"; q.payload = x;
                q.conflicto = String(opciones.onConflict || "").split(",").filter(Boolean);
                q.ignorar = !!opciones.ignoreDuplicates;
                return b;
            },
            update(x) { q.op = "update"; q.payload = x; return b; },
            delete() { q.op = "delete"; return b; },
            eq(c, v) { q.filtros.push(f => f[c] === v); return b; },
            neq(c, v) { q.filtros.push(f => f[c] !== v); return b; },
            in(c, vs) { q.filtros.push(f => vs.includes(f[c])); return b; },
            // not(col, "is", null) — la única forma que usa el backend.
            not(c, op, v) {
                if (op !== "is") throw new Error(`fake not(): operador no soportado ${op}`);
                q.filtros.push(f => (v === null ? f[c] != null : f[c] !== v));
                return b;
            },
            lte(c, v) { q.filtros.push(f => f[c] != null && comparar(f[c], v) <= 0); return b; },
            lt(c, v) { q.filtros.push(f => f[c] != null && comparar(f[c], v) < 0); return b; },
            gte(c, v) { q.filtros.push(f => f[c] != null && comparar(f[c], v) >= 0); return b; },
            is(c, v) { q.filtros.push(f => (v === null ? f[c] == null : f[c] === v)); return b; },
            // "col.eq.valor,col.is.null,col.not.in.(a,b),..." (sintaxis
            // PostgREST, condiciones simples; las comas dentro de paréntesis
            // son de la lista, no separan condiciones)
            or(expr) {
                const partes = String(expr).match(/[^,(]+(\([^)]*\))?/g) || [];
                const conds = partes.map(c => {
                    const [col, op, ...resto] = c.split(".");
                    const val = resto.join(".");
                    const lista = (v) => v.replace(/^in\.\(|^\(|\)$/g, "").split(",").filter(Boolean);
                    if (op === "eq") return f => String(f[col]) === val;
                    if (op === "is" && val === "null") return f => f[col] == null;
                    if (op === "in") return f => f[col] != null && lista(val).includes(String(f[col]));
                    if (op === "not" && val.startsWith("in.")) return f => f[col] != null && !lista(val).includes(String(f[col]));
                    throw new Error(`fake or(): condición no soportada ${c}`);
                });
                q.filtros.push(f => conds.some(fn => fn(f)));
                return b;
            },
            order(c, { ascending = true } = {}) { q.orden = { c, ascending }; return b; },
            limit(n) { q.limite = n; return b; },
            single() { q.unico = "single"; return b; },
            maybeSingle() { q.unico = "maybe"; return b; },
            then(ok, ko) { return Promise.resolve().then(ejecutar).then(ok, ko); }
        };

        function ejecutar() {

            control.llamadas.push({ tabla, op: q.op });

            if (control.fallarTabla === tabla) return { data: null, error: { message: `fallo simulado en ${tabla}` } };
            if (control.tablasInexistentes?.has(tabla)) return { data: null, error: { code: "42P01", message: `relation "public.${tabla}" does not exist` } };

            const filas = tablas[tabla] || (tablas[tabla] = []);

            if (q.op === "upsert") {
                const resultado = [];
                const aInsertar = [];
                for (const fila of Array.isArray(q.payload) ? q.payload : [q.payload]) {
                    const existente = q.conflicto.length && !q.conflicto.some(c => fila[c] == null)
                        ? filas.find(f => q.conflicto.every(c => f[c] === fila[c]))
                        : null;
                    if (existente) { if (!q.ignorar) { Object.assign(existente, fila); resultado.push(existente); } continue; }
                    aInsertar.push(fila);
                }
                if (aInsertar.length) { q.op = "insert"; q.payload = aInsertar; }
                else return { data: q.devolver ? resultado.map(f => ({ ...f })) : null, error: null };
            }

            if (q.op === "insert") {

                const nuevas = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(f => ({
                    // UUID válido: las rutas rechazan ids con otro formato.
                    id: `00000000-0000-4000-8000-${String(++secuencia).padStart(12, "0")}`,
                    creado_en: new Date(Date.now() + secuencia).toISOString(),
                    ...(DEFECTOS[tabla] ? DEFECTOS[tabla]() : {}),
                    ...f
                }));

                for (const n of nuevas) {
                    for (const cols of UNICAS[tabla] || []) {
                        if (cols.some(c => n[c] == null)) continue;
                        if ([...filas, ...nuevas.filter(x => x !== n)].some(f => cols.every(c => f[c] === n[c]))) {
                            return { data: null, error: { code: "23505", message: "duplicate key value" } };
                        }
                    }
                }

                filas.push(...nuevas);
                const copia = nuevas.map(f => ({ ...f }));
                if (!q.devolver) return { data: null, error: null };
                return { data: q.unico ? copia[0] : copia, error: null };

            }

            // Gancho de pruebas: otra escritura concurrente justo ANTES de un
            // UPDATE (p. ej. una reserva que entra durante un reinicio).
            if (q.op === "update" && typeof control.antesDeEscribir === "function") control.antesDeEscribir(tabla);

            let res = filas.filter(f => q.filtros.every(fn => fn(f)));

            if (q.op === "delete") {
                tablas[tabla] = filas.filter(f => !res.includes(f));
                return { data: q.devolver ? res.map(f => ({ ...f })) : null, error: null };
            }

            if (q.op === "update") res.forEach(f => Object.assign(f, q.payload));

            // Gancho de pruebas: simula otra escritura concurrente justo
            // después de una lectura (p. ej. un pago entre leer y liberar).
            if (q.op === "select" && typeof control.despuesDeLeer === "function") control.despuesDeLeer(tabla);

            if (q.orden) res = [...res].sort((a, z) => (q.orden.ascending ? 1 : -1) * comparar(a[q.orden.c], z[q.orden.c]));
            if (q.limite != null) res = res.slice(0, q.limite);

            const copia = res.map(f => ({ ...f }));

            if (q.contar) return { data: q.cabecera ? null : copia, count: copia.length, error: null };

            if (q.op === "update" && !q.devolver) return { data: null, error: null };
            if (q.unico === "single") return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 o varias filas" } };
            if (q.unico === "maybe") return { data: copia[0] || null, error: null };

            return { data: copia, error: null };

        }

        return b;

    }

    const client = {
        from,
        auth: {
            // tokens[token]: el id del usuario, o { id, email }.
            getUser: async (token) => (tokens[token]
                ? { data: { user: typeof tokens[token] === "object" ? { ...tokens[token] } : { id: tokens[token] } }, error: null }
                : { data: { user: null }, error: { message: "invalid JWT" } })
        }
    };

    return { client, tablas, tokens, control };

}

module.exports = { crearFake };
