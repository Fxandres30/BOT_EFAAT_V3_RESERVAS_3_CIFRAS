// ==========================================================================
// sorteos/calendario.js — cálculo PURO (sin Supabase) del horario de una
// lotería del catálogo para una fecha, en America/Bogota.
//
// No inventa horarios: si el catálogo no tiene la hora, los días o la regla
// de festivos, devuelve hora null y un aviso. El administrador decide.
//
// Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"):
//   - fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic;
//   - trasladables al lunes siguiente: 6 ene, 19 mar, 29 jun, 15 ago,
//     12 oct, 1 nov, 11 nov;
//   - según la Pascua: Jueves y Viernes Santo; Ascensión (+43), Corpus
//     Christi (+64) y Sagrado Corazón (+71), ya trasladados al lunes.
// ==========================================================================

const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const utc = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
const iso = (f) => f.toISOString().slice(0, 10);
const sumarDias = (f, n) => new Date(f.getTime() + n * 86400000);

// Domingo de Pascua (algoritmo anónimo gregoriano / Meeus).
function pascua(anio) {
    const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return utc(anio, mes, dia);
}

// Lunes siguiente (o el mismo día si ya es lunes).
function alLunes(f) {
    const dow = f.getUTCDay();             // 0 domingo … 6 sábado
    return dow === 1 ? f : sumarDias(f, (8 - dow) % 7);
}

const cache = new Map();

function festivosColombia(anio) {

    if (cache.has(anio)) return cache.get(anio);

    const p = pascua(anio);
    const lista = [
        [utc(anio, 1, 1), "Año Nuevo"],
        [alLunes(utc(anio, 1, 6)), "Reyes Magos"],
        [alLunes(utc(anio, 3, 19)), "San José"],
        [sumarDias(p, -3), "Jueves Santo"],
        [sumarDias(p, -2), "Viernes Santo"],
        [utc(anio, 5, 1), "Día del Trabajo"],
        [sumarDias(p, 43), "Ascensión del Señor"],
        [sumarDias(p, 64), "Corpus Christi"],
        [sumarDias(p, 71), "Sagrado Corazón"],
        [alLunes(utc(anio, 6, 29)), "San Pedro y San Pablo"],
        [utc(anio, 7, 20), "Independencia de Colombia"],
        [utc(anio, 8, 7), "Batalla de Boyacá"],
        [alLunes(utc(anio, 8, 15)), "Asunción de la Virgen"],
        [alLunes(utc(anio, 10, 12)), "Día de la Raza"],
        [alLunes(utc(anio, 11, 1)), "Todos los Santos"],
        [alLunes(utc(anio, 11, 11)), "Independencia de Cartagena"],
        [utc(anio, 12, 8), "Inmaculada Concepción"],
        [utc(anio, 12, 25), "Navidad"]
    ];

    const mapa = new Map(lista.map(([f, n]) => [iso(f), n]));
    cache.set(anio, mapa);
    return mapa;

}

function festivoDe(fecha) {
    const m = FECHA.exec(fecha || "");
    return m ? festivosColombia(Number(m[1])).get(fecha) || null : null;
}

// 1 = lunes … 7 = domingo (ISO), para una fecha "YYYY-MM-DD".
function diaSemana(fecha) {
    const m = FECHA.exec(fecha);
    const dow = utc(Number(m[1]), Number(m[2]), Number(m[3])).getUTCDay();
    return dow === 0 ? 7 : dow;
}

const horaValida = (h) => (typeof h === "string" && HORA.test(h) ? h : null);

// horarioPara(loteria, "YYYY-MM-DD") -> {
//   fecha, dia_semana, dia_nombre, festivo, juega (true|false|null),
//   hora ("HH:MM"|null: la SUGERIDA), hora_del_dia (la del día de la semana,
//   aunque sea festivo), origen, avisos[] }
function horarioPara(loteria, fecha) {

    if (!FECHA.test(fecha || "")) return { ok: false, motivo: "validacion", errores: [{ campo: "fecha", mensaje: "Fecha inválida (AAAA-MM-DD)." }] };

    const dia = diaSemana(fecha);
    const festivo = festivoDe(fecha);
    const dias = Array.isArray(loteria.dias) ? loteria.dias.map(Number) : [];
    const porDia = loteria.horas_por_dia || {};
    const horaDelDia = horaValida(porDia[String(dia)]) || horaValida(loteria.hora);
    const avisos = [];

    let juega = dias.length ? dias.includes(dia) : null;
    let hora = null;
    let origen = null;

    if (loteria.activo === false) avisos.push("Esta lotería está marcada como inactiva en el catálogo.");

    if (festivo) {

        const regla = loteria.regla_festivo || "sin_regla";

        if (regla === "no_se_juega") {
            juega = false;
            avisos.push(`${fecha} es festivo (${festivo}): según el catálogo, esta lotería no se juega en festivos.`);
        } else if (regla === "hora_especial") {
            hora = horaValida(loteria.hora_festivo);
            origen = "festivo";
            juega = true;
            if (!hora) avisos.push(`${fecha} es festivo (${festivo}): la regla dice «hora especial» pero no tiene hora configurada.`);
        } else if (regla === "hora_habitual") {
            hora = horaDelDia;
            origen = "festivo_hora_habitual";
            juega = true;
            if (!hora) avisos.push(`${fecha} es festivo (${festivo}) y esta lotería no tiene horario configurado.`);
        } else {
            avisos.push(`${fecha} es festivo (${festivo}) y esta lotería no tiene una regla para festivos. Confirma la hora antes de programar.`);
        }

    } else if (juega === false) {

        avisos.push(`Según el catálogo, esta lotería no se juega los ${DIAS[dia]}.`);

    } else {

        hora = horaDelDia;
        origen = horaValida(porDia[String(dia)]) ? "dia" : hora ? "habitual" : null;

        if (juega === null) {
            avisos.push(dia === 7
                ? "Es domingo y esta lotería no tiene días configurados: no hay regla para domingos. Confirma la hora."
                : "Esta lotería no tiene días configurados en el catálogo. Confirma la hora.");
        }
        if (!hora) avisos.push("Esta lotería no tiene horario configurado en el catálogo. Escribe la hora a mano.");

    }

    return {
        ok: true,
        data: { fecha, dia_semana: dia, dia_nombre: DIAS[dia], festivo, juega, hora, hora_del_dia: horaDelDia, origen, avisos }
    };

}

module.exports = {
    festivosColombia,
    festivoDe,
    diaSemana,
    horarioPara,
    DIAS
};
