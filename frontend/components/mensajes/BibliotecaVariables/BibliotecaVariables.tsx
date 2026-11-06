"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";

import {
    EntradaBiblioteca,
    agruparBiblioteca,
    buscarEnBiblioteca,
    variablesPrincipales
} from "@/services/mensajes/bibliotecaVariables";

import styles from "./BibliotecaVariables.module.css";

interface Props {
    biblioteca: EntradaBiblioteca[];
    onInsertar: (clave: string) => void;
}

const MARCA_DISPONIBILIDAD: Record<EntradaBiblioteca["disponibilidad"], string> = {
    esta_respuesta: styles.dispOk,
    disponible: styles.dispOk,
    segun_cantidad: styles.dispInfo,
    personalizada: styles.dispInfo,
    puede_vacia: styles.dispAviso
};

// «Agrega información automática»: botones con nombres comprensibles. Al
// pulsar uno se inserta el código real ({{clave}}) donde está el cursor.
export default function BibliotecaVariables({ biblioteca, onInsertar }: Props) {

    const [abierta, setAbierta] = useState(false);
    const [consulta, setConsulta] = useState("");

    const principales = useMemo(() => variablesPrincipales(biblioteca), [biblioteca]);

    const grupos = useMemo(
        () => agruparBiblioteca(buscarEnBiblioteca(biblioteca, consulta)),
        [biblioteca, consulta]
    );

    const totalCoincidencias = grupos.reduce((n, g) => n + g.entradas.length, 0);

    return (

        <section className={styles.bloque} aria-labelledby="titulo-info-automatica">

            <div className={styles.cabecera}>
                <h3 id="titulo-info-automatica" className={styles.titulo}>Agrega información automática</h3>
                <p className={styles.ayuda}>Pulsa un botón y EFAAT pondrá el dato real de cada cliente en ese lugar.</p>
            </div>

            <div className={styles.principales}>
                {principales.map((e) => (
                    <button
                        key={e.clave}
                        type="button"
                        className={styles.chip}
                        title={`${e.textoDisponibilidad} Código: {{${e.clave}}}`}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => onInsertar(e.clave)}
                    >
                        <Plus size={12} aria-hidden="true" />
                        {e.nombre}
                    </button>
                ))}
            </div>

            <button
                type="button"
                className={styles.toggle}
                aria-expanded={abierta}
                aria-controls="mas-variables"
                onClick={() => setAbierta((v) => !v)}
            >
                <ChevronDown size={14} className={abierta ? styles.girado : ""} aria-hidden="true" />
                {abierta ? "Ocultar más variables" : `Más variables (${biblioteca.length})`}
            </button>

            {abierta && (

                <div id="mas-variables" className={styles.mas}>

                    <label className={styles.buscador}>
                        <Search size={14} aria-hidden="true" />
                        <input
                            type="search"
                            placeholder="Buscar: nombre, precio, pagados…"
                            value={consulta}
                            onChange={(e) => setConsulta(e.target.value)}
                            aria-label="Buscar variables"
                        />
                    </label>

                    {totalCoincidencias === 0 && (
                        <p className={styles.sinResultados}>Ninguna variable coincide con «{consulta}».</p>
                    )}

                    {grupos.map((g) => (

                        <div key={g.grupo} className={styles.grupo}>

                            <p className={styles.grupoTitulo}>{g.grupo}</p>

                            <ul className={styles.lista}>
                                {g.entradas.map((e) => (
                                    <li key={e.clave}>
                                        <button
                                            type="button"
                                            className={styles.fila}
                                            onMouseDown={(ev) => ev.preventDefault()}
                                            onClick={() => onInsertar(e.clave)}
                                            aria-label={`Insertar ${e.nombre}`}
                                        >
                                            <span className={styles.filaPrincipal}>
                                                <span className={styles.filaNombre}>{e.nombre}</span>
                                                <code className={styles.codigo}>{`{{${e.clave}}}`}</code>
                                            </span>
                                            {e.descripcion && e.descripcion !== e.nombre && (
                                                <span className={styles.filaDesc}>{e.descripcion}</span>
                                            )}
                                            <span className={`${styles.disp} ${MARCA_DISPONIBILIDAD[e.disponibilidad]}`}>
                                                {e.textoDisponibilidad}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>

                        </div>

                    ))}

                    <p className={styles.notaAvanzada}>
                        Para cambiar mayúsculas agrega un modificador al código:{" "}
                        <code>{"{{cliente|upper}}"}</code>, <code>{"|lower"}</code>, <code>{"|capitalize"}</code> o{" "}
                        <code>{"|title"}</code>. También puedes escribir <code>{"{"}</code> en el mensaje para buscar.
                    </p>

                </div>

            )}

        </section>

    );

}
