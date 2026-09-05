// ==========================================================================
// Fake de Supabase para las pruebas del bucle de reconexión de sockets
// (manager.js / socket.js / estados.js / desconectado.js / conectado.js).
//
// Aislado a propósito de backend/tests/identidad/fakeSupabase.js: estas
// pruebas no deben tocar nada de identidades/escáner, ni compartir estado
// con esas pruebas.
//
// Implementa únicamente el subconjunto de la API encadenable de
// supabase-js que usan los archivos bajo prueba sobre la tabla "sesiones":
//
//   .from("sesiones").select(cols).eq(c,v).in(c,vs).single()/.maybeSingle()
//   .from("sesiones").update(obj).eq(c,v)
//
// Además implementa .rpc(nombre, params) para las 3 funciones atómicas de
// supabase_migrations/004_lease_sesiones.sql (lease_sesiones_acquire /
// _heartbeat / _release), replicando en JS EXACTAMENTE la misma semántica
// que la migración SQL real (mismo contrato de "adquirido"/"renovado"/
// "liberado", mismas condiciones de expiración) — no se puede ejecutar
// Postgres real en este entorno de pruebas, así que esto es lo que valida
// el comportamiento del lease a nivel de lógica.
//
// El "reloj" del lease es virtual y controlable (_lease.avanzar(ms)) para
// poder probar expiración de TTL sin sleeps reales.
// ==========================================================================

function crearFakeSupabaseSesiones(filasIniciales = []) {

    let filas = filasIniciales.map(f => ({ ...f }));

    // ---------------------------------------------------------------
    // RPC de lease — réplica en JS de 004_lease_sesiones.sql
    // ---------------------------------------------------------------
    const leaseFilas = new Map(); // session_id -> { owner_id, lease_until: Date, heartbeat_at: Date, updated_at: Date }
    let offsetRelojMs = 0;

    function ahoraLease() {
        return new Date(Date.now() + offsetRelojMs);
    }

    function rpcAcquire(p_session_id, p_owner_id, p_ttl_seconds) {

        const ahora = ahoraLease();
        const leaseUntil = new Date(ahora.getTime() + Math.max(Number(p_ttl_seconds) || 0, 1) * 1000);
        const actual = leaseFilas.get(p_session_id);

        const puedeAdquirir = !actual || actual.owner_id === p_owner_id || actual.lease_until <= ahora;

        if (puedeAdquirir) {
            leaseFilas.set(p_session_id, {
                owner_id: p_owner_id,
                lease_until: leaseUntil,
                heartbeat_at: ahora,
                updated_at: ahora
            });
        }

        const fila = leaseFilas.get(p_session_id);

        return [{
            session_id: p_session_id,
            owner_id: fila.owner_id,
            lease_until: fila.lease_until.toISOString(),
            heartbeat_at: fila.heartbeat_at.toISOString(),
            adquirido: puedeAdquirir
        }];

    }

    function rpcHeartbeat(p_session_id, p_owner_id, p_ttl_seconds) {

        const ahora = ahoraLease();
        const actual = leaseFilas.get(p_session_id);

        const puedeRenovar = !!actual && actual.owner_id === p_owner_id && actual.lease_until > ahora;

        if (puedeRenovar) {
            actual.lease_until = new Date(ahora.getTime() + Math.max(Number(p_ttl_seconds) || 0, 1) * 1000);
            actual.heartbeat_at = ahora;
            actual.updated_at = ahora;
        }

        const fila = leaseFilas.get(p_session_id);

        return [{
            session_id: p_session_id,
            owner_id: fila ? fila.owner_id : null,
            lease_until: fila ? fila.lease_until.toISOString() : null,
            renovado: puedeRenovar
        }];

    }

    function rpcRelease(p_session_id, p_owner_id) {

        const actual = leaseFilas.get(p_session_id);
        const puedeLiberar = !!actual && actual.owner_id === p_owner_id;

        if (puedeLiberar) {
            leaseFilas.delete(p_session_id);
        }

        return [{ liberado: puedeLiberar }];

    }

    function crearQuery() {

        let modo = null; // 'select' | 'update'
        let payload = null;
        const filtrosEq = [];
        const filtrosIn = [];

        function coincide(fila) {
            return filtrosEq.every(([c, v]) => fila[c] === v) &&
                filtrosIn.every(([c, vs]) => vs.includes(fila[c]));
        }

        const builder = {

            select(_cols) {
                if (modo === null) modo = "select";
                return builder;
            },

            update(obj) {
                modo = "update";
                payload = obj;
                return builder;
            },

            eq(campo, valor) {
                filtrosEq.push([campo, valor]);
                return builder;
            },

            in(campo, valores) {
                filtrosIn.push([campo, valores]);
                return builder;
            },

            single() {

                const coincidentes = filas.filter(coincide);

                if (modo === "update") {
                    return ejecutarUpdate();
                }

                if (coincidentes.length !== 1) {
                    return Promise.resolve({
                        data: null,
                        error: { message: "single(): 0 o más de 1 fila coincidente" }
                    });
                }

                return Promise.resolve({ data: { ...coincidentes[0] }, error: null });

            },

            maybeSingle() {

                if (modo === "update") {
                    return ejecutarUpdate();
                }

                const coincidentes = filas.filter(coincide);

                return Promise.resolve({
                    data: coincidentes.length ? { ...coincidentes[0] } : null,
                    error: null
                });

            },

            then(onFulfilled, onRejected) {
                return ejecutar().then(onFulfilled, onRejected);
            }

        };

        function ejecutarUpdate() {

            const actualizadas = [];

            filas = filas.map(fila => {

                if (!coincide(fila)) return fila;

                const nueva = { ...fila, ...payload };
                actualizadas.push(nueva);
                return nueva;

            });

            return Promise.resolve({ data: actualizadas, error: null });

        }

        async function ejecutar() {

            if (modo === "update") {
                return ejecutarUpdate();
            }

            if (modo === "select") {
                return { data: filas.filter(coincide).map(f => ({ ...f })), error: null };
            }

            return { data: null, error: { message: `fakeSupabaseSesiones: modo no soportado (${modo})` } };

        }

        return builder;

    }

    const client = {

        from(nombreTabla) {

            if (nombreTabla !== "sesiones") {
                throw new Error(`fakeSupabaseSesiones: tabla no soportada "${nombreTabla}"`);
            }

            return crearQuery();

        },

        rpc(nombreFuncion, params = {}) {

            return (async () => {

                try {

                    if (nombreFuncion === "lease_sesiones_acquire") {
                        return { data: rpcAcquire(params.p_session_id, params.p_owner_id, params.p_ttl_seconds), error: null };
                    }

                    if (nombreFuncion === "lease_sesiones_heartbeat") {
                        return { data: rpcHeartbeat(params.p_session_id, params.p_owner_id, params.p_ttl_seconds), error: null };
                    }

                    if (nombreFuncion === "lease_sesiones_release") {
                        return { data: rpcRelease(params.p_session_id, params.p_owner_id), error: null };
                    }

                    return { data: null, error: { message: `fakeSupabaseSesiones: rpc no soportado (${nombreFuncion})` } };

                } catch (err) {

                    return { data: null, error: { message: err.message } };

                }

            })();

        }

    };

    return {
        client,
        // Acceso directo para preparar/inspeccionar el estado desde las pruebas.
        _filas: () => filas,
        _agregarSesion(fila) {
            filas.push({ ...fila });
        },
        _obtenerSesion(id) {
            return filas.find(f => f.id === id);
        },
        // Inspección/control directo del lease, para las pruebas del lease
        // distribuido: sembrar un lease "ya tomado por otro owner",
        // avanzar el reloj virtual para forzar expiración de TTL sin
        // sleeps reales, y leer el estado crudo tras una operación.
        _lease: {
            filas: leaseFilas,
            avanzar(ms) {
                offsetRelojMs += ms;
            },
            sembrar(sessionId, { ownerId, ttlSegundosRestantes }) {
                const ahora = ahoraLease();
                leaseFilas.set(sessionId, {
                    owner_id: ownerId,
                    lease_until: new Date(ahora.getTime() + ttlSegundosRestantes * 1000),
                    heartbeat_at: ahora,
                    updated_at: ahora
                });
            },
            obtener(sessionId) {
                return leaseFilas.get(sessionId) || null;
            }
        }
    };

}

module.exports = { crearFakeSupabaseSesiones };
