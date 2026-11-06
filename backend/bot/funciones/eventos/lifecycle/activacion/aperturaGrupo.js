// ==========================================================================
// Apertura del grupo de WhatsApp al activar un sorteo (F4), con su registro
// en la fila (`abierto`). Lo COMPARTIDO por todas las entradas:
//   - WhatsApp confirma → si la fila tenía una apertura pendiente
//     (abierto=false), se registra abierto=true, condicionado a activo=true;
//   - WhatsApp no confirma → abierto=false, para que el worker de eventos la
//     reintente.
// Lo PROPIO de cada entrada es cómo se registra el fallo (POLITICAS):
//   panel      una escritura, solo si la fila no estaba ya en false
//   deteccion  siempre, con 3 intentos cortos (marcarAperturaFallida)
// La reconciliación del worker (workerEventos) es otra entrada (F4-G).
// ==========================================================================

"use strict";

// Reintento breve y acotado (3 intentos, 300 ms aparte) SOLO para registrar
// que la apertura falló (abierto=false). Riesgo que cierra: si WhatsApp falla
// Y esta escritura también fallara al primer intento, el evento quedaría con
// abierto=true «mintiendo» y la reconciliación del worker (que filtra por
// abierto===false) nunca lo encontraría. No es una tabla ni un estado nuevo:
// reintenta la MISMA escritura de siempre. -> true si quedó registrado.
async function marcarAperturaFallida(db, eventoId) {
    const intentos = 3;
    for (let i = 1; i <= intentos; i++) {
        const { error } = await db.from("eventos_bot").update({ abierto: false }).eq("id", eventoId);
        if (!error) return true;
        console.error(`❌ No se pudo registrar abierto=false (intento ${i}/${intentos}):`, error.message);
        if (i < intentos) await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

const POLITICAS = Object.freeze({
    panel: async (db, evento) => {
        if (evento.abierto !== false) await db.from("eventos_bot").update({ abierto: false }).eq("id", evento.id);
    },
    deteccion: async (db, evento) => {
        // WhatsApp NO confirmó la apertura (típicamente rate-overlimit tras
        // agotar los reintentos de la cola): se registra abierto=false en el
        // evento YA guardado para que el worker lo reintente. El evento existe
        // (activo=true) y las reservas siguen funcionando.
        console.log("⚠ No se pudo abrir el grupo en WhatsApp — se registra abierto=false para reintento.");
        let registrado = false;
        try {
            registrado = await marcarAperturaFallida(db, evento.id);
        } catch (e) {
            console.error("❌ No se pudo registrar abierto=false:", e?.message);
        }
        if (registrado) {
            evento.abierto = false;
        } else {
            // El evento podrá autocorregirse si el mismo mensaje se detecta de
            // nuevo (se reintenta abrir y se registra abierto=true).
            console.error(`⚠️ Evento ${evento.id}: quedó sin poder registrar el fallo de apertura tras los reintentos.`);
        }
    }
});

// -> true (WhatsApp confirmó) | false
async function abrirGrupoDelEvento({ db, sock, evento, abrirGrupo, politica = "panel" }) {
    const registrarFallo = POLITICAS[politica];
    if (!registrarFallo) throw new Error(`abrirGrupoDelEvento: política desconocida: ${politica}`);

    const abierto = await abrirGrupo({ sock, grupoId: evento.grupo_id });
    if (!abierto) {
        await registrarFallo(db, evento);
        return false;
    }

    // guardarEvento no reescribe `abierto`: una apertura pendiente de un
    // intento anterior se registra aquí, tras la confirmación de WhatsApp.
    if (evento.abierto === false) await registrarAperturaConfirmada(db, evento);
    return true;
}

// WhatsApp confirmó la apertura del grupo: abierto=true, SOLO sobre una fila
// activa (una que otro cierre terminó entretanto no se toca). La usan la
// activación y la reconciliación del worker (F4-G).
// -> true si quedó registrada en ESTA fila.
async function registrarAperturaConfirmada(db, evento) {
    const { data, error } = await db.from("eventos_bot").update({ abierto: true }).eq("id", evento.id).eq("activo", true).select();
    if (error) {
        console.error(`❌ No se pudo registrar abierto=true del evento ${evento.id} (lo hará el worker):`, error.message);
        return false;
    }
    if (!Array.isArray(data) || data.length === 0) return false;
    evento.abierto = true;
    return true;
}

module.exports = { abrirGrupoDelEvento, registrarAperturaConfirmada, marcarAperturaFallida, POLITICAS };
