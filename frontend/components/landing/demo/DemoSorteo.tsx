"use client";

// Demostración interactiva de la landing: un grupo de WhatsApp simulado y el
// panel del organizador, lado a lado. Todo vive en el estado de React
// (sesionDemo.ts): ni Supabase, ni fetch, ni WhatsApp, ni almacenamiento del
// navegador. Al recargar la página se pierde.

import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
    Activity,
    BadgeCheck,
    Bell,
    Check,
    LayoutGrid,
    Receipt,
    RotateCcw,
    SendHorizontal,
    Sticker,
    Unlock,
    Users,
    X
} from "lucide-react";

import { formatearCOP } from "@/lib/comercial/planes";
import {
    EVENTO_DEMO,
    PARTICIPANTES_DEMO,
    PRECIO_DEMO,
    contarTabla,
    duenosDe,
    formatearNumero,
    listaNumeros,
    numerosDe
} from "./simuladorDemo";
import {
    ORGANIZADOR,
    crearSesion,
    pagoPendienteMasReciente,
    reducirDemo,
    textoAviso
} from "./sesionDemo";
import type { AccionDemo, Aviso, MensajeChat } from "./sesionDemo";
import styles from "./demo.module.css";

const RETARDO_RESPUESTA_MS = 450;

const AUTORES = [...PARTICIPANTES_DEMO, ORGANIZADOR];

// Sugerencias para la primera prueba: reserva completa (✅), parcial,
// todos ocupados (❌), consultas, pago y pedido de soltar.
const SUGERENCIAS = [
    "Me anotas el 15 y el 16",
    "Quiero el 20, 45 y 46",
    "Apártame el 03 y el 07",
    "¿Cuáles son mis números?",
    "¿Cuántos tengo?",
    "¿Cuánto debo?",
    "¿Cuánto es todo lo mío?",
    "¿Qué números quedan?",
    "¿El 23 está libre?",
    "Ya pagué",
    "Ya no quiero el 15"
];

type Pestana = "tabla" | "participantes" | "actividad";

function claseAutor(nombre: string): string {
    const i = (PARTICIPANTES_DEMO as readonly string[]).indexOf(nombre);
    if (nombre === ORGANIZADOR) return styles.autorOrganizador;
    return i >= 0 ? styles[`autor${i + 1}`] : styles.autorOtro;
}

function Burbuja({ m }: { m: MensajeChat }) {

    switch (m.clase) {

        case "sistema":
            return <li className={`${styles.mensaje} ${styles.sistema}`}>{m.texto}</li>;

        case "nota":
            return (
                <li className={`${styles.mensaje} ${styles.nota}`}>
                    <span className={styles.notaEtiqueta}>Demostración</span>
                    <span>{m.texto}</span>
                </li>
            );

        case "bot":
            return (
                <li className={`${styles.mensaje} ${styles.bot}`}>
                    <span className={`${styles.autor} ${styles.autorBot}`}>EFAAT (respuesta automática)</span>
                    <span className={styles.texto}>{m.texto}</span>
                </li>
            );

        case "texto":
            return (
                <li className={`${styles.mensaje} ${styles.participante}`}>
                    <span className={`${styles.autor} ${claseAutor(m.autor)}`}>{m.autor}</span>
                    <span className={styles.texto}>{m.texto}</span>
                    {m.reaccion && (
                        <span className={styles.reaccion} aria-label={`Reacción automática ${m.reaccion}`}>{m.reaccion}</span>
                    )}
                </li>
            );

        case "comprobante":
            return (
                <li className={`${styles.mensaje} ${styles.participante}`}>
                    <span className={`${styles.autor} ${claseAutor(m.autor)}`}>{m.autor}</span>
                    <span className={styles.comprobante}>
                        <Receipt size={28} aria-hidden="true" />
                        <span>
                            <strong>Comprobante de pago</strong>
                            <span className={styles.comprobanteDetalle}>
                                Imagen de ejemplo · {formatearCOP(m.numeros.length * PRECIO_DEMO)} · {listaNumeros(m.numeros)}
                            </span>
                        </span>
                    </span>
                </li>
            );

        case "sticker":
            return (
                <li className={`${styles.mensaje} ${styles.stickerMensaje}`}>
                    <span className={`${styles.autor} ${claseAutor(m.autor)}`}>{m.autor}</span>
                    {m.cita && (
                        <span className={styles.cita}>
                            <span className={`${styles.citaAutor} ${claseAutor(m.cita.autor)}`}>{m.cita.autor}</span>
                            <span>{m.cita.texto}</span>
                        </span>
                    )}
                    <span className={m.dePago ? styles.stickerPago : styles.stickerSimple} aria-label={m.dePago ? "Sticker de pago" : "Sticker"}>
                        {m.dePago ? <><BadgeCheck size={30} aria-hidden="true" />PAGADO</> : "🍀"}
                    </span>
                </li>
            );

    }

}

function FilaAviso({ a, enviar }: { a: Aviso; enviar: (accion: AccionDemo) => void }) {
    const esPago = a.tipo === "comprobante" || a.tipo === "aviso_pago";
    return (
        <li className={styles.avisoPendiente} data-aviso={a.tipo}>
            <span className={styles.avisoIcono} aria-hidden="true">{esPago ? <Receipt size={16} /> : <Unlock size={16} />}</span>
            <span className={styles.avisoTexto}>{textoAviso(a)}</span>
            <span className={styles.avisoAcciones}>
                {esPago ? (
                    <>
                        <button type="button" className={styles.botonAprobar} onClick={() => enviar({ tipo: "aprobar", avisoId: a.id })}>
                            <Check size={14} aria-hidden="true" />Aprobar
                        </button>
                        <button type="button" className={styles.botonSecundario} onClick={() => enviar({ tipo: "rechazar", avisoId: a.id })}>
                            <X size={14} aria-hidden="true" />Rechazar
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className={styles.botonPeligro} onClick={() => enviar({ tipo: "liberar", numeros: a.numeros, avisoId: a.id })}>
                            <Unlock size={14} aria-hidden="true" />Liberar
                        </button>
                        <button type="button" className={styles.botonSecundario} onClick={() => enviar({ tipo: "mantener", avisoId: a.id })}>
                            Mantener
                        </button>
                    </>
                )}
            </span>
        </li>
    );
}

export default function DemoSorteo() {

    const [sesion, enviar] = useReducer(reducirDemo, undefined, crearSesion);
    const [autor, setAutor] = useState<string>(PARTICIPANTES_DEMO[0]);
    const [texto, setTexto] = useState("");
    const [pestana, setPestana] = useState<Pestana>("tabla");
    const [filtro, setFiltro] = useState<string | null>(null);
    const [seleccionado, setSeleccionado] = useState<number | null>(null);
    const [avisosVistos, setAvisosVistos] = useState(0);

    const listaChat = useRef<HTMLOListElement>(null);
    const campo = useRef<HTMLInputElement>(null);

    const { tabla, mensajes, avisos, resaltados, enEspera } = sesion;

    // Respuesta automática con un pequeño retardo, como en un chat real.
    useEffect(() => {
        if (!enEspera) return;
        const t = setTimeout(() => enviar({ tipo: "responder" }), RETARDO_RESPUESTA_MS);
        return () => clearTimeout(t);
    }, [enEspera]);

    // Desplaza solo la lista del chat (nunca la página completa).
    useEffect(() => {
        const lista = listaChat.current;
        if (lista) lista.scrollTop = lista.scrollHeight;
    }, [mensajes, enEspera]);

    const esOrganizador = autor === ORGANIZADOR;
    const conteo = contarTabla(tabla);
    const pendientes = avisos.filter((a) => a.estado === "pendiente");
    const historial = avisos.filter((a) => a.estado !== "pendiente");
    const nuevosEnActividad = Math.max(0, avisos.length - avisosVistos);
    const pagoPendiente = pagoPendienteMasReciente(sesion);
    const pendientesAutor = esOrganizador ? [] : numerosDe(tabla, autor).reservados;
    const casillaSeleccionada = seleccionado !== null ? tabla[seleccionado] : null;

    // Entrar o salir de Actividad marca como vistos los avisos existentes.
    function cambiarPestana(id: Pestana) {
        if (id === "actividad" || pestana === "actividad") setAvisosVistos(avisos.length);
        setPestana(id);
    }

    function enviarTexto(mensaje: string) {
        if (!mensaje.trim() || enEspera) return;
        enviar({ tipo: "enviar", autor, texto: mensaje });
        setTexto("");
    }

    function alEnviar(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        enviarTexto(texto);
    }

    function tocarNumero(n: number) {
        if (tabla[n] === null) {
            setSeleccionado(null);
            if (esOrganizador) setAutor(PARTICIPANTES_DEMO[0]);
            setTexto(`Me anotas el ${formatearNumero(n)}`);
            campo.current?.focus();
        } else {
            setSeleccionado(seleccionado === n ? null : n);
        }
    }

    function reiniciar() {
        enviar({ tipo: "reiniciar" });
        setTexto("");
        setSeleccionado(null);
        setFiltro(null);
        setAvisosVistos(0);
        setPestana("tabla");
    }

    const otrosDuenos = duenosDe(tabla).filter((d) => !(PARTICIPANTES_DEMO as readonly string[]).includes(d));
    const resumen = [...PARTICIPANTES_DEMO, ...otrosDuenos].map((nombre) => ({ nombre, ...numerosDe(tabla, nombre) }));

    return (
        <div className={styles.demo} data-demo="sorteo">

            <p className={styles.aviso} role="note">
                <strong>Simulación.</strong> No envía mensajes de WhatsApp, no se conecta a ningún sorteo real
                y no guarda datos: todo ocurre en tu navegador y se borra al recargar la página.
                Los nombres, números y comprobantes son ficticios. Reacciones: ✅ si se reservan todos los números pedidos,
                ❌ si todos estaban ocupados y ninguna si la reserva es parcial.
            </p>

            <div className={styles.cuadricula}>

                {/* ---------- Chat ---------- */}
                <section className={styles.chat} aria-labelledby="demo-chat-titulo">
                    <header className={styles.chatCabecera}>
                        <span className={styles.chatAvatar} aria-hidden="true">S</span>
                        <div>
                            <h3 id="demo-chat-titulo" className={styles.chatTitulo}>Grupo de sorteos (ejemplo)</h3>
                            <p className={styles.chatSub}>{PARTICIPANTES_DEMO.join(", ")}, {ORGANIZADOR} y EFAAT</p>
                        </div>
                    </header>

                    <div className={styles.selectorAutor} role="radiogroup" aria-label="Escribes como">
                        <span className={styles.selectorEtiqueta}>Escribes como</span>
                        {AUTORES.map((a) => (
                            <button
                                key={a}
                                type="button"
                                role="radio"
                                aria-checked={autor === a}
                                className={`${styles.opcionAutor} ${autor === a ? styles.opcionActiva : ""}`}
                                onClick={() => setAutor(a)}
                            >
                                <span className={`${styles.puntoAutor} ${claseAutor(a)}`} aria-hidden="true" />
                                {a}
                            </button>
                        ))}
                    </div>

                    <ol ref={listaChat} className={styles.mensajes} aria-live="polite" aria-label="Conversación simulada">
                        {mensajes.map((m) => <Burbuja key={m.id} m={m} />)}
                        {enEspera && (
                            <li className={`${styles.mensaje} ${styles.bot} ${styles.escribiendo}`}>
                                <span className={`${styles.autor} ${styles.autorBot}`}>EFAAT</span>
                                <span>escribiendo…</span>
                            </li>
                        )}
                    </ol>

                    {esOrganizador ? (
                        <p className={styles.pistaOrganizador}>
                            {pagoPendiente
                                ? `Responde con el sticker de pago para confirmar el pago de ${pagoPendiente.participante}.`
                                : "Escribe como un participante y envía un comprobante; luego vuelve aquí para confirmarlo con el sticker de pago."}
                        </p>
                    ) : (
                        <div className={styles.sugerencias} aria-label="Mensajes de ejemplo">
                            {SUGERENCIAS.map((s) => (
                                <button key={s} type="button" className={styles.sugerencia} onClick={() => enviarTexto(s)} disabled={!!enEspera}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}

                    <form className={styles.formulario} onSubmit={alEnviar}>
                        {!esOrganizador && (
                            <button
                                type="button"
                                className={styles.botonAdjunto}
                                onClick={() => enviar({ tipo: "comprobante", autor })}
                                disabled={!!enEspera}
                                title={pendientesAutor.length ? "Enviar un comprobante de ejemplo" : `${autor} no tiene números pendientes de pago`}
                                aria-label="Enviar comprobante de ejemplo"
                            >
                                <Receipt size={20} aria-hidden="true" />
                            </button>
                        )}
                        <button
                            type="button"
                            className={`${styles.botonAdjunto} ${esOrganizador && pagoPendiente ? styles.botonDestacado : ""}`}
                            onClick={() => enviar({ tipo: "sticker", autor })}
                            disabled={!!enEspera}
                            aria-label={esOrganizador ? "Enviar sticker de pago" : "Enviar sticker"}
                            title={esOrganizador ? "Sticker de pago" : "Sticker"}
                        >
                            <Sticker size={20} aria-hidden="true" />
                        </button>
                        <label htmlFor="demo-mensaje" className={styles.oculto}>Mensaje para el grupo de ejemplo</label>
                        <input
                            ref={campo}
                            id="demo-mensaje"
                            className={styles.campo}
                            value={texto}
                            onChange={(e) => setTexto(e.target.value)}
                            maxLength={200}
                            autoComplete="off"
                            placeholder={esOrganizador ? "Mensaje del organizador" : `Escribe como ${autor}…`}
                        />
                        <button type="submit" className={styles.enviar} disabled={!texto.trim() || !!enEspera} aria-label="Enviar">
                            <SendHorizontal size={20} aria-hidden="true" />
                        </button>
                    </form>
                </section>

                {/* ---------- Panel del organizador ---------- */}
                <section className={styles.panel} aria-labelledby="demo-panel-titulo">
                    <header className={styles.panelCabecera}>
                        <div>
                            <h3 id="demo-panel-titulo" className={styles.panelTitulo}>Panel del organizador</h3>
                            <p className={styles.panelSub}>{EVENTO_DEMO} · {formatearCOP(PRECIO_DEMO)} por número</p>
                        </div>
                        <button type="button" className={styles.reiniciar} onClick={reiniciar}>
                            <RotateCcw size={14} aria-hidden="true" />Reiniciar
                        </button>
                    </header>

                    <dl className={styles.contadores}>
                        <div><dt>Disponibles</dt><dd data-contador="libres">{conteo.libres}</dd></div>
                        <div><dt>Reservados</dt><dd data-contador="reservados">{conteo.reservados}</dd></div>
                        <div><dt>Pagados</dt><dd data-contador="pagados">{conteo.pagados}</dd></div>
                        <div><dt>Recaudado</dt><dd data-contador="recaudado">{formatearCOP(conteo.pagados * PRECIO_DEMO)}</dd></div>
                        <div><dt>Por cobrar</dt><dd data-contador="por-cobrar">{formatearCOP(conteo.reservados * PRECIO_DEMO)}</dd></div>
                    </dl>

                    {pendientes.length > 0 && (
                        <div className={styles.pendientes} role="region" aria-label="Pendientes de revisar">
                            <p className={styles.pendientesTitulo}><Bell size={14} aria-hidden="true" />Por revisar ({pendientes.length})</p>
                            <ul className={styles.listaPendientes}>
                                {pendientes.map((a) => <FilaAviso key={a.id} a={a} enviar={enviar} />)}
                            </ul>
                        </div>
                    )}

                    <div className={styles.pestanas} role="tablist" aria-label="Vistas del panel">
                        {([
                            ["tabla", "Tabla", LayoutGrid],
                            ["participantes", "Participantes", Users],
                            ["actividad", "Actividad", Activity]
                        ] as const).map(([id, nombre, Icono]) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                id={`demo-pestana-${id}`}
                                aria-selected={pestana === id}
                                aria-controls={`demo-vista-${id}`}
                                className={`${styles.pestana} ${pestana === id ? styles.pestanaActiva : ""}`}
                                onClick={() => cambiarPestana(id)}
                            >
                                <Icono size={15} aria-hidden="true" />
                                {nombre}
                                {id === "actividad" && nuevosEnActividad > 0 && pestana !== "actividad" && (
                                    <span className={styles.insignia} aria-label={`${nuevosEnActividad} nuevas`}>{nuevosEnActividad}</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {pestana === "tabla" && (
                        <div id="demo-vista-tabla" role="tabpanel" aria-labelledby="demo-pestana-tabla" className={styles.vista}>
                            <div className={styles.filtros} role="group" aria-label="Resaltar números de">
                                <button type="button" className={`${styles.filtro} ${filtro === null ? styles.filtroActivo : ""}`} aria-pressed={filtro === null} onClick={() => setFiltro(null)}>
                                    Todos
                                </button>
                                {PARTICIPANTES_DEMO.map((p) => (
                                    <button key={p} type="button" className={`${styles.filtro} ${filtro === p ? styles.filtroActivo : ""}`} aria-pressed={filtro === p} onClick={() => setFiltro(filtro === p ? null : p)}>
                                        <span className={`${styles.puntoAutor} ${claseAutor(p)}`} aria-hidden="true" />{p}
                                    </button>
                                ))}
                            </div>

                            <div className={styles.tabla} role="group" aria-label="Tabla de números 00 a 99">
                                {tabla.map((c, n) => {
                                    const clase = c === null ? styles.libre : c.estado === "pagado" ? styles.pagado : styles.reservado;
                                    const atenuada = filtro !== null && c?.dueno !== filtro;
                                    const etiqueta = c === null
                                        ? `${formatearNumero(n)}, disponible. Seleccionar para pedirlo en el chat`
                                        : `${formatearNumero(n)}, ${c.estado} por ${c.dueno}`;
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`${styles.celda} ${clase} ${resaltados.includes(n) ? styles.nuevo : ""} ${atenuada ? styles.atenuada : ""} ${seleccionado === n ? styles.seleccionada : ""}`}
                                            onClick={() => tocarNumero(n)}
                                            aria-label={etiqueta}
                                            aria-pressed={c !== null ? seleccionado === n : undefined}
                                            data-numero={formatearNumero(n)}
                                            data-estado={c === null ? "libre" : c.estado}
                                            data-dueno={c?.dueno ?? ""}
                                        >
                                            {formatearNumero(n)}
                                            {c && <span className={`${styles.inicial} ${claseAutor(c.dueno)}`} aria-hidden="true">{c.dueno[0]}</span>}
                                        </button>
                                    );
                                })}
                            </div>

                            {seleccionado !== null && casillaSeleccionada && (
                                <div className={styles.detalle} role="region" aria-label={`Número ${formatearNumero(seleccionado)}`}>
                                    <span>
                                        <strong>{formatearNumero(seleccionado)}</strong> · {casillaSeleccionada.dueno} ·{" "}
                                        {casillaSeleccionada.estado === "pagado" ? "Pagado" : "Reservado, pendiente de pago"}
                                    </span>
                                    <span className={styles.avisoAcciones}>
                                        {casillaSeleccionada.estado === "reservado" && (
                                            <button type="button" className={styles.botonAprobar} onClick={() => enviar({ tipo: "pagar", numeros: [seleccionado] })}>
                                                <Check size={14} aria-hidden="true" />Marcar pagado
                                            </button>
                                        )}
                                        <button type="button" className={styles.botonPeligro} onClick={() => { enviar({ tipo: "liberar", numeros: [seleccionado] }); setSeleccionado(null); }}>
                                            <Unlock size={14} aria-hidden="true" />Liberar
                                        </button>
                                    </span>
                                </div>
                            )}

                            <ul className={styles.leyenda} aria-label="Leyenda">
                                <li><span className={`${styles.punto} ${styles.libre}`} aria-hidden="true" />Disponible</li>
                                <li><span className={`${styles.punto} ${styles.reservado}`} aria-hidden="true" />Reservado</li>
                                <li><span className={`${styles.punto} ${styles.pagado}`} aria-hidden="true" />Pagado</li>
                                <li>Toca un número ocupado para gestionarlo</li>
                            </ul>
                        </div>
                    )}

                    {pestana === "participantes" && (
                        <div id="demo-vista-participantes" role="tabpanel" aria-labelledby="demo-pestana-participantes" className={styles.vista}>
                            <ul className={styles.participantes}>
                                {resumen.map((p) => (
                                    <li key={p.nombre} className={styles.filaParticipante} data-participante={p.nombre}>
                                        <div className={styles.participanteCabecera}>
                                            <span className={`${styles.puntoAutor} ${claseAutor(p.nombre)}`} aria-hidden="true" />
                                            <strong>{p.nombre}</strong>
                                            <span className={styles.participanteTotales}>
                                                {p.todos.length} {p.todos.length === 1 ? "número" : "números"}
                                                {p.reservados.length > 0 && <> · debe {formatearCOP(p.reservados.length * PRECIO_DEMO)}</>}
                                                {p.todos.length > 0 && p.reservados.length === 0 && <> · al día</>}
                                            </span>
                                        </div>
                                        {p.todos.length > 0 ? (
                                            <div className={styles.fichas}>
                                                {p.todos.map((n) => (
                                                    <span key={n} className={`${styles.ficha} ${tabla[n]?.estado === "pagado" ? styles.pagado : styles.reservado}`}>
                                                        {formatearNumero(n)}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className={styles.vacio}>Sin números todavía</p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {pestana === "actividad" && (
                        <div id="demo-vista-actividad" role="tabpanel" aria-labelledby="demo-pestana-actividad" className={styles.vista}>
                            {historial.length === 0 ? (
                                <p className={styles.vacio}>Todavía no hay actividad. Reserva un número desde el chat.</p>
                            ) : (
                                <ol className={styles.actividad}>
                                    {historial.map((a) => (
                                        <li key={a.id} className={styles.filaActividad} data-aviso={a.tipo}>
                                            <span className={`${styles.puntoAutor} ${claseAutor(a.participante)}`} aria-hidden="true" />
                                            <span>{textoAviso(a)}{a.estado === "resuelto" && " · revisado"}</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    )}
                </section>

            </div>
        </div>
    );
}
