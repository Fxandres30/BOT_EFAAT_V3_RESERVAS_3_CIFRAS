// ==========================================================================
// Ciclo de automatización al activar un sorteo (F4), según el perfil. Usa el
// MOTOR CENTRAL de siempre (automation/motorEventos): un evento es un evento,
// venga de donde venga. Nunca impide la activación.
//   antes_de_abrir (detección)  registrar el ciclo antes de abrir el grupo y,
//                               tras la confirmación de WhatsApp, abrirlo y
//                               enviar el OPEN_MESSAGE en segundo plano
//   tras_anuncio (panel)        registrar y confirmar después de enviar el
//                               anuncio con la imagen
// ==========================================================================

"use strict";

// El motor decide con las reglas de siempre si el evento tiene ciclo y lo
// crea, o devuelve el que ya tenía. Un fallo del propio motor (p. ej. sin las
// tablas de la 006) NUNCA impide abrir el grupo: solo deja este ciclo sin
// extras automáticos. -> el ciclo o null.
async function registrarAntesDeAbrir(motor, evento) {
    try {
        const decision = await motor.registrarEvento(evento);
        const ciclo = decision.eventSession || null;
        if (ciclo) console.log(`🤖 [AUTOMATION] event_session ${decision.nuevo ? "creado" : "existente"} — recordatorios/actualización/cierre/tabla/OPEN_MESSAGE habilitados:`, ciclo.id);
        else console.log(`🤖 [AUTOMATION] sin event_session (${decision.motivo}) — el grupo se abre igual por el mecanismo existente; sin extras automáticos para este ciclo.`);
        return ciclo;
    } catch (err) {
        console.error("❌ [AUTOMATION] error evaluando automatización (sin extras automáticos para este ciclo, la apertura del grupo continúa):", err?.message);
        return null;
    }
}

// Tras la confirmación real de la apertura: abre el ciclo y envía el
// OPEN_MESSAGE UNA vez por ciclo, en segundo plano (nunca retrasa la
// detección). Sin ciclo no hay extras; el grupo ya se abrió igual.
function confirmarEnSegundoPlano(motor, { evento, ciclo, sock }) {
    if (!ciclo) return;
    motor.enSegundoPlano(motor.confirmarApertura({ evento, eventSession: ciclo, sock }));
}

// Panel: después del anuncio, como en WhatsApp. «ya_enviado» = un intento
// anterior se cortó tras enviar: el motor lo completa sin repetir nada.
// Nunca cambia el resultado de la publicación.
async function arrancarTrasAnuncio(motor, { evento, sock, ahora }) {
    await motor.procesarEventoPublicado({ evento, sock, ahora, tablaPublicada: true });
}

module.exports = { registrarAntesDeAbrir, confirmarEnSegundoPlano, arrancarTrasAnuncio };
