"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { segmentarFormatoWhatsApp } from "@/services/mensajes/formatoWhatsApp";

import styles from "./VistaPreviaWhatsApp.module.css";

export interface CasoVistaPrevia {
    id: string;
    etiqueta: string;
    texto: string;
}

interface Props {
    casos: CasoVistaPrevia[];
    vacio: boolean;
    datosOcultos?: number;
}

function Burbuja({ texto }: { texto: string }) {

    const segmentos = segmentarFormatoWhatsApp(texto);

    return (
        <div className={styles.burbuja} data-testid="vista-previa-burbuja">
            <span className={styles.texto}>
                {segmentos.map((s, i) => {
                    let nodo: React.ReactNode = s.texto;
                    if (s.mono) nodo = <code className={styles.mono}>{nodo}</code>;
                    if (s.tachado) nodo = <s>{nodo}</s>;
                    if (s.cursiva) nodo = <em>{nodo}</em>;
                    if (s.negrita) nodo = <strong>{nodo}</strong>;
                    return <span key={i}>{nodo}</span>;
                })}
            </span>
            <span className={styles.hora} aria-hidden="true">12:00 ✓✓</span>
        </div>
    );

}

// Vista previa con apariencia de chat de WhatsApp. Recibe el texto YA
// sustituido por el mismo motor del editor (aplicarPlantillaPreview); aquí
// solo se dibuja.
export default function VistaPreviaWhatsApp({ casos, vacio, datosOcultos = 0 }: Props) {

    const [casoId, setCasoId] = useState(casos[0]?.id);
    const caso = casos.find((c) => c.id === casoId) || casos[0];

    return (

        <section className={styles.panel} aria-label="Vista previa del mensaje">

            <header className={styles.cabecera}>
                <span className={styles.titulo}><Eye size={14} aria-hidden="true" /> Así se verá</span>
                <span className={styles.demo}>Datos de ejemplo</span>
            </header>

            {casos.length > 1 && (
                <div className={styles.casos} role="tablist" aria-label="Caso de ejemplo">
                    {casos.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            role="tab"
                            aria-selected={c.id === caso?.id}
                            className={`${styles.caso} ${c.id === caso?.id ? styles.casoActivo : ""}`}
                            onClick={() => setCasoId(c.id)}
                        >
                            {c.etiqueta}
                        </button>
                    ))}
                </div>
            )}

            <div className={styles.chat}>
                {vacio ? (
                    <p className={styles.vacio}>Escribe tu mensaje y aquí verás cómo lo recibirá el cliente.</p>
                ) : caso && caso.texto.trim() ? (
                    <Burbuja texto={caso.texto} />
                ) : (
                    <p className={styles.vacio}>Con estos datos de ejemplo el mensaje quedaría vacío.</p>
                )}
            </div>

            <p className={styles.nota}>
                Nombres, números y fechas son de demostración: el cliente recibirá sus datos reales.
                {datosOcultos > 0 && ` ${datosOcultos} dato${datosOcultos === 1 ? "" : "s"} oculto${datosOcultos === 1 ? "" : "s"} en «Opciones avanzadas».`}
            </p>

        </section>

    );

}
