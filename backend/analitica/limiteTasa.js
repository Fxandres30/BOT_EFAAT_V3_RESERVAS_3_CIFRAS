// ==========================================================================
// Rate limiting en memoria (token bucket) para el endpoint público de
// ingestión. Tres cubos por evento:
//
//   ip        30 de ráfaga, 1 cada 2 s   (uso real: navegación + 1 heartbeat/min)
//   visitante 20 de ráfaga, 1 cada 4 s   (visitor_id lo inventa el cliente,
//                                         por eso no basta solo con él)
//   global    300 de ráfaga, 20/s        (techo de escrituras a Supabase
//                                         aunque el atacante rote IP y id)
//
// En memoria por proceso: si el backend corre en LOCAL y VPS a la vez, cada
// uno tiene sus cubos — suficiente para contener abuso, no es contabilidad.
// ==========================================================================

function crearLimitador({ capacidad, porSegundo, maxClaves = 50000 }) {

    const cubos = new Map();

    function permitir(clave, ahora = Date.now()) {

        let cubo = cubos.get(clave);

        if (!cubo) {

            if (cubos.size >= maxClaves) {
                // Protección de memoria: se descartan los cubos más viejos.
                const sobran = Math.ceil(maxClaves / 10);
                for (const k of cubos.keys()) {
                    cubos.delete(k);
                    if (cubos.size <= maxClaves - sobran) break;
                }
            }

            cubo = { fichas: capacidad, en: ahora };
            cubos.set(clave, cubo);

        }

        cubo.fichas = Math.min(capacidad, cubo.fichas + ((ahora - cubo.en) / 1000) * porSegundo);
        cubo.en = ahora;

        if (cubo.fichas < 1) return false;

        cubo.fichas -= 1;
        return true;

    }

    return { permitir, tamano: () => cubos.size, limpiar: () => cubos.clear() };

}

const porIp = crearLimitador({ capacidad: 30, porSegundo: 0.5 });
const porVisitante = crearLimitador({ capacidad: 20, porSegundo: 0.25 });
const global = crearLimitador({ capacidad: 300, porSegundo: 20 });

function permitirEvento({ ip, visitorId }, ahora = Date.now()) {

    if (!global.permitir("global", ahora)) return false;
    if (ip && !porIp.permitir(ip, ahora)) return false;
    if (!porVisitante.permitir(visitorId, ahora)) return false;

    return true;

}

function reiniciar() {
    porIp.limpiar();
    porVisitante.limpiar();
    global.limpiar();
}

module.exports = { crearLimitador, permitirEvento, reiniciar };
