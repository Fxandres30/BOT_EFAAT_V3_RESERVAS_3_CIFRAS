"use client";

// Demostración interactiva de la landing. Todo vive en el estado de React:
// ni Supabase, ni fetch, ni WhatsApp. Al recargar la página se pierde.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { formatearCOP } from "@/lib/comercial/planes";
import {
    EVENTO_DEMO,
    PARTICIPANTE_DEMO,
    PRECIO_DEMO,
    contarLibres,
    crearEstadoInicial,
    formatearNumero,
    numerosDe,
    procesarMensaje
} from "./simuladorDemo";
import type { EstadoDemo } from "./simuladorDemo";
import styles from "./demo.module.css";

interface MensajeChat {
    id: number;
    autor: "participante" | "bot" | "sistema";
    texto: string;
    reaccion?: string | null;
}

// Una sugerencia por cada caso de reacción (✅ todos reservados, sin
// reacción en la reserva parcial, ❌ todos ocupados) y la consulta de los
// números propios.
const SUGERENCIAS = [
    "Me anotas el 15 y el 16",
    "Me anotas el 23 y el 45",
    "Quiero el 03 y el 07",
    "¿Cuáles son mis números?"
];

const RETARDO_RESPUESTA_MS = 450;

function mensajesIniciales(): MensajeChat[] {
    return [
        {
            id: 1,
            autor: "sistema",
            texto: `EFAAT publicó la tabla del ${EVENTO_DEMO.toLowerCase()} · valor por número ${formatearCOP(PRECIO_DEMO)}`
        }
    ];
}

export default function DemoSorteo() {

    const [estado, setEstado] = useState<EstadoDemo>(crearEstadoInicial);
    const [mensajes, setMensajes] = useState<MensajeChat[]>(mensajesIniciales);
    const [texto, setTexto] = useState("");
    const [escribiendo, setEscribiendo] = useState(false);
    const [resaltados, setResaltados] = useState<number[]>([]);

    const siguienteId = useRef(2);
    const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listaChat = useRef<HTMLOListElement>(null);
    const campo = useRef<HTMLInputElement>(null);

    useEffect(() => () => {
        if (temporizador.current) clearTimeout(temporizador.current);
    }, []);

    // Desplaza solo la lista del chat (nunca la página completa).
    useEffect(() => {
        const lista = listaChat.current;
        if (lista) lista.scrollTop = lista.scrollHeight;
    }, [mensajes, escribiendo]);

    function enviar(mensaje: string) {

        const limpio = mensaje.trim().slice(0, 200);
        if (!limpio || escribiendo) return;

        const idMensaje = siguienteId.current++;
        setMensajes((m) => [...m, { id: idMensaje, autor: "participante", texto: limpio }]);
        setTexto("");
        setEscribiendo(true);

        const r = procesarMensaje(estado, limpio);

        temporizador.current = setTimeout(() => {
            setEstado(r.estado);
            setResaltados(r.reservados);
            setMensajes((m) => [
                ...m.map((x) => (x.id === idMensaje ? { ...x, reaccion: r.reaccion } : x)),
                { id: siguienteId.current++, autor: "bot", texto: r.respuesta }
            ]);
            setEscribiendo(false);
        }, RETARDO_RESPUESTA_MS);

    }

    function alEnviar(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        enviar(texto);
    }

    function elegirNumero(n: number) {
        setTexto(`Me anotas el ${formatearNumero(n)}`);
        campo.current?.focus();
    }

    function reiniciar() {
        if (temporizador.current) clearTimeout(temporizador.current);
        setEstado(crearEstadoInicial());
        setMensajes(mensajesIniciales());
        setResaltados([]);
        setEscribiendo(false);
        setTexto("");
        siguienteId.current = 2;
    }

    const mios = numerosDe(estado, PARTICIPANTE_DEMO);
    const libres = contarLibres(estado);

    return (
        <div className={styles.demo} data-demo="sorteo">

            <p className={styles.aviso} role="note">
                <strong>Simulación.</strong> No envía mensajes de WhatsApp, no se conecta a ningún sorteo real
                y no guarda datos: todo ocurre en tu navegador y se borra al recargar la página.
                Los nombres y números son ficticios. Reacciones: ✅ si se reservan todos los números pedidos,
                ❌ si todos estaban ocupados y ninguna si la reserva es parcial.
            </p>

            <div className={styles.cuadricula}>

                <section className={styles.chat} aria-labelledby="demo-chat-titulo">
                    <header className={styles.chatCabecera}>
                        <span className={styles.chatAvatar} aria-hidden="true">S</span>
                        <div>
                            <h3 id="demo-chat-titulo" className={styles.chatTitulo}>Grupo de sorteos (ejemplo)</h3>
                            <p className={styles.chatSub}>Escribes como {PARTICIPANTE_DEMO}, participante de ejemplo</p>
                        </div>
                    </header>

                    <ol ref={listaChat} className={styles.mensajes} aria-live="polite" aria-label="Conversación simulada">
                        {mensajes.map((m) => (
                            <li key={m.id} className={`${styles.mensaje} ${styles[m.autor]}`}>
                                {m.autor === "bot" && <span className={styles.autor}>EFAAT (respuesta automática)</span>}
                                {m.autor === "participante" && <span className={styles.autor}>{PARTICIPANTE_DEMO}</span>}
                                <span>{m.texto}</span>
                                {m.reaccion && (
                                    <span className={styles.reaccion} aria-label={`Reacción automática ${m.reaccion}`}>{m.reaccion}</span>
                                )}
                            </li>
                        ))}
                        {escribiendo && (
                            <li className={`${styles.mensaje} ${styles.bot} ${styles.escribiendo}`}>
                                <span className={styles.autor}>EFAAT</span>
                                <span>escribiendo…</span>
                            </li>
                        )}
                    </ol>

                    <div className={styles.sugerencias} aria-label="Mensajes de ejemplo">
                        {SUGERENCIAS.map((s) => (
                            <button key={s} type="button" className={styles.sugerencia} onClick={() => enviar(s)} disabled={escribiendo}>
                                {s}
                            </button>
                        ))}
                    </div>

                    <form className={styles.formulario} onSubmit={alEnviar}>
                        <label htmlFor="demo-mensaje" className={styles.oculto}>Mensaje para el grupo de ejemplo</label>
                        <input
                            ref={campo}
                            id="demo-mensaje"
                            className={styles.campo}
                            value={texto}
                            onChange={(e) => setTexto(e.target.value)}
                            maxLength={200}
                            autoComplete="off"
                            placeholder="Escribe, por ejemplo: me anotas el 15"
                        />
                        <button type="submit" className={styles.enviar} disabled={!texto.trim() || escribiendo}>
                            Enviar
                        </button>
                    </form>
                </section>

                <section className={styles.panel} aria-labelledby="demo-panel-titulo">
                    <header className={styles.panelCabecera}>
                        <div>
                            <h3 id="demo-panel-titulo" className={styles.panelTitulo}>Panel del organizador</h3>
                            <p className={styles.panelSub}>{EVENTO_DEMO} · {formatearCOP(PRECIO_DEMO)} por número</p>
                        </div>
                        <button type="button" className={styles.reiniciar} onClick={reiniciar}>Reiniciar</button>
                    </header>

                    <dl className={styles.contadores}>
                        <div><dt>Disponibles</dt><dd data-contador="libres">{libres}</dd></div>
                        <div><dt>Reservados</dt><dd>{100 - libres}</dd></div>
                        <div><dt>De {PARTICIPANTE_DEMO}</dt><dd data-contador="mios">{mios.length}</dd></div>
                    </dl>

                    <div className={styles.tabla} role="group" aria-label="Tabla de números 00 a 99">
                        {estado.map((dueno, n) => {
                            const esMio = dueno === PARTICIPANTE_DEMO;
                            const clase = dueno === null ? styles.libre : esMio ? styles.mio : styles.ocupado;
                            const etiqueta = dueno === null
                                ? `${formatearNumero(n)}, disponible. Seleccionar para reservar`
                                : esMio ? `${formatearNumero(n)}, reservado por ${PARTICIPANTE_DEMO}` : `${formatearNumero(n)}, ocupado`;
                            return (
                                <button
                                    key={n}
                                    type="button"
                                    className={`${styles.celda} ${clase} ${resaltados.includes(n) ? styles.nuevo : ""}`}
                                    onClick={() => elegirNumero(n)}
                                    disabled={dueno !== null}
                                    aria-label={etiqueta}
                                    data-numero={formatearNumero(n)}
                                    data-estado={dueno === null ? "libre" : esMio ? "mio" : "ocupado"}
                                >
                                    {formatearNumero(n)}
                                </button>
                            );
                        })}
                    </div>

                    <ul className={styles.leyenda} aria-label="Leyenda">
                        <li><span className={`${styles.punto} ${styles.libre}`} aria-hidden="true" />Disponible</li>
                        <li><span className={`${styles.punto} ${styles.ocupado}`} aria-hidden="true" />Ocupado</li>
                        <li><span className={`${styles.punto} ${styles.mio}`} aria-hidden="true" />De {PARTICIPANTE_DEMO}</li>
                    </ul>
                </section>

            </div>
        </div>
    );
}
