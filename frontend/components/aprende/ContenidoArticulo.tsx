import type { Articulo } from "@/lib/aprende/articulos";

import styles from "./Aprende.module.css";

// Cuerpo de un artículo con la plantilla común. Lo usan la página del
// artículo y la ayuda contextual (modal). Los bloques vacíos no se muestran.
export default function ContenidoArticulo({ articulo, nivel = "h2" }: { articulo: Articulo; nivel?: "h2" | "h3" }) {

    const H = nivel;

    return (

        <div className={styles.contenido}>

            <section className={styles.bloque}>
                <H>¿Para qué sirve?</H>
                <p>{articulo.paraQueSirve}</p>
            </section>

            {articulo.antes.length > 0 && (
                <section className={styles.bloque}>
                    <H>Antes de empezar</H>
                    <ul>{articulo.antes.map((t) => <li key={t}>{t}</li>)}</ul>
                </section>
            )}

            <section className={styles.bloque}>
                <H>Paso a paso</H>
                <ol>{articulo.pasos.map((t) => <li key={t}>{t}</li>)}</ol>
            </section>

            {articulo.estados.length > 0 && (
                <section className={styles.bloque}>
                    <H>¿Qué significa cada estado?</H>
                    <dl className={styles.estados}>
                        {articulo.estados.map((e) => (
                            <div key={e.nombre} style={{ display: "contents" }}>
                                <dt>{e.nombre}</dt>
                                <dd>{e.significado}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            {articulo.errores.length > 0 && (
                <section className={styles.bloque}>
                    <H>Errores frecuentes</H>
                    <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                        {articulo.errores.map((e) => (
                            <li key={e.sintoma} className={styles.error}>
                                <strong>{e.sintoma}</strong>
                                {e.comprobar}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className={styles.bloque}>
                <H>¿Qué hago si no funciona?</H>
                <ul>{articulo.siNoFunciona.map((t) => <li key={t}>{t}</li>)}</ul>
            </section>

        </div>

    );

}
