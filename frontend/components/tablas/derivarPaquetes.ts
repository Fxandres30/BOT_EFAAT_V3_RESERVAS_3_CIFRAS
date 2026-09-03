import type { NumeroReserva, PaqueteReserva, EstadoNumero } from "./types";

// Un "paquete" (Grupo en la interfaz) es el conjunto de números que un
// mismo cliente reservó juntos: comparten evento_id + contacto/teléfono +
// fecha y hora de reserva exactas, que es como reservarNumeros.js escribe
// una reserva de varios números en una sola llamada. No es el grupo de
// WhatsApp (grupo_id/grupo_nombre) — ese se conserva aparte en cada fila.
export function derivarPaquetes(numeros: NumeroReserva[]): PaqueteReserva[] {

    const filas = numeros.filter(n => n.estado !== "libre" && n.fecha_reserva && n.hora_reserva);

    const mapa = new Map<string, NumeroReserva[]>();

    for (const fila of filas) {

        const identificador = fila.contacto || fila.telefono || fila.comprador || "sin-contacto";

        const clave = [
            fila.evento_id || "sin-evento",
            identificador,
            fila.fecha_reserva,
            fila.hora_reserva
        ].join("|");

        const grupo = mapa.get(clave) || [];
        grupo.push(fila);
        mapa.set(clave, grupo);

    }

    const paquetes: PaqueteReserva[] = [];

    for (const [clave, filasGrupo] of mapa) {

        if (filasGrupo.length < 2)
            continue;

        const primera = filasGrupo[0];

        const estados = new Set(filasGrupo.map(f => f.estado));

        const estado: EstadoNumero | "mixto" = estados.size === 1
            ? (estados.values().next().value as EstadoNumero)
            : "mixto";

        paquetes.push({
            id: clave,
            cliente: primera.comprador || primera.nombre,
            contacto: primera.contacto || primera.telefono,
            numeros: filasGrupo.map(f => f.numero).sort(),
            estado,
            grupoWhatsApp: primera.grupo_nombre,
            eventoId: primera.evento_id,
            fechaReserva: primera.fecha_reserva,
            horaReserva: primera.hora_reserva,
            totalFilas: filasGrupo.length
        });

    }

    return paquetes.sort((a, b) => {
        const fechaA = `${a.fechaReserva}T${a.horaReserva}`;
        const fechaB = `${b.fechaReserva}T${b.horaReserva}`;
        return fechaB.localeCompare(fechaA);
    });

}
