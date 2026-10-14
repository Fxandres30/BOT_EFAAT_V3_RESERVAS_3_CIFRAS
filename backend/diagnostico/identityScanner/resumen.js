// ==========================================================================
// IDENTITY SCANNER — estadísticas a partir de los JSONL (solo lectura).
//
//     node backend/diagnostico/identityScanner/resumen.js [archivo.jsonl ...]
//
// Sin argumentos lee todos los identity_scanner_*.jsonl de
// backend/reportes_identidad/. No toca Supabase ni el bot.
// ==========================================================================

const fs = require("fs");
const path = require("path");

const DIRECTORIO = path.resolve(__dirname, "../../reportes_identidad");

function contar(mapa, clave) {
    const k = clave == null ? "(ninguno)" : String(clave);
    mapa[k] = (mapa[k] || 0) + 1;
}

// resumir(registros) — PURA.
function resumir(registros) {

    const r = {
        total: registros.length,
        porTipoChat: {}, porTipoMensaje: {}, porAddressingMode: {}, porCaso: {},
        porUpsertType: {}, envoltorios: {},
        conAlterno: 0, conUsername: 0, conPushName: 0, conCitado: 0, citadoAudio: 0,
        lidMapping: { consultados: 0, conPn: 0, sinPn: 0, timeout: 0, error: 0 },
        identificadoresUnicos: { pn: 0, lid: 0 },
        paresPnLid: 0,
        lidConVariosPn: 0,
        pnConVariosLid: 0,
        desconocidos: { camposKey: {}, tiposMensaje: {} }
    };

    const unicos = { pn: new Set(), lid: new Set() };
    const pnsPorLid = new Map();
    const lidsPorPn = new Map();

    const unir = (lid, pn) => {
        if (!lid || !pn) return;
        if (!pnsPorLid.has(lid)) pnsPorLid.set(lid, new Set());
        if (!lidsPorPn.has(pn)) lidsPorPn.set(pn, new Set());
        pnsPorLid.get(lid).add(pn);
        lidsPorPn.get(pn).add(lid);
    };

    for (const reg of registros) {

        contar(r.porTipoChat, reg.tipoChat);
        contar(r.porTipoMensaje, reg.tipoMensaje);
        contar(r.porAddressingMode, reg.clave?.addressingMode);
        contar(r.porCaso, reg.remitente?.caso);
        contar(r.porUpsertType, reg.upsertType);
        (reg.envoltorios || []).forEach((e) => contar(r.envoltorios, e));

        if (reg.remitente?.alterno) r.conAlterno++;
        if (reg.remitente?.username?.presente) r.conUsername++;
        if (reg.pushName?.presente) r.conPushName++;
        if (reg.citado?.participant) r.conCitado++;
        if (reg.citado?.participant && reg.tipoMensaje === "audioMessage") r.citadoAudio++;

        const ids = [reg.remitente?.principal, reg.remitente?.alterno].filter(Boolean);
        for (const id of ids) if (unicos[id.clase]) unicos[id.clase].add(id.h);

        const lid = ids.find((i) => i.clase === "lid")?.h;
        const pn = ids.find((i) => i.clase === "pn")?.h;
        unir(lid, pn);

        for (const m of reg.lidMapping?.pnParaLid || []) {
            r.lidMapping.consultados++;
            if (m.pn === "timeout") r.lidMapping.timeout++;
            else if (m.pn === "error") r.lidMapping.error++;
            else if (m.pn) { r.lidMapping.conPn++; unir(m.lid?.h, m.pn.h); }
            else r.lidMapping.sinPn++;
        }

        (reg.desconocidos?.camposKey || []).forEach((c) => contar(r.desconocidos.camposKey, c));
        (reg.desconocidos?.tiposMensaje || []).forEach((c) => contar(r.desconocidos.tiposMensaje, c));

    }

    r.identificadoresUnicos = { pn: unicos.pn.size, lid: unicos.lid.size };
    r.paresPnLid = [...pnsPorLid.values()].reduce((n, s) => n + s.size, 0);
    // Señales de "cambio de identificador" o datos inconsistentes:
    r.lidConVariosPn = [...pnsPorLid.values()].filter((s) => s.size > 1).length;
    r.pnConVariosLid = [...lidsPorPn.values()].filter((s) => s.size > 1).length;

    return r;

}

function leerJsonl(archivos) {
    const registros = [];
    for (const archivo of archivos) {
        for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
            if (!linea.trim()) continue;
            try { registros.push(JSON.parse(linea)); } catch (_) { /* línea corrupta: se ignora */ }
        }
    }
    return registros;
}

if (require.main === module) {
    const argumentos = process.argv.slice(2);
    const archivos = argumentos.length
        ? argumentos
        : (fs.existsSync(DIRECTORIO) ? fs.readdirSync(DIRECTORIO).filter((f) => /^identity_scanner_.*\.jsonl$/.test(f)).map((f) => path.join(DIRECTORIO, f)) : []);
    console.log(JSON.stringify(resumir(leerJsonl(archivos)), null, 2));
}

module.exports = { resumir, leerJsonl };
