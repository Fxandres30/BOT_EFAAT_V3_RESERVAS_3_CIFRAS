"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, GraduationCap, Search, SearchX } from "lucide-react";

import { Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import {
    ARTICULOS,
    CATEGORIAS,
    PRIMEROS_PASOS,
    articulosDe,
    buscarArticulos,
    categoriaPorId,
    type Articulo
} from "@/lib/aprende/articulos";

import IconoCategoria from "./IconoCategoria";
import styles from "./Aprende.module.css";

function TarjetaArticulo({ articulo, conCategoria = false }: { articulo: Articulo; conCategoria?: boolean }) {
    return (
        <li>
            <Link href={`/aprende/${articulo.slug}`} prefetch={false} className={styles.articulo}>
                <span className={styles.articuloTexto}>
                    <span className={styles.articuloTitulo}>{articulo.titulo}</span>
                    <span className={styles.articuloDesc}>
                        {conCategoria && `${categoriaPorId(articulo.categoria)?.titulo} · `}{articulo.descripcion}
                    </span>
                </span>
                <span className={styles.minutos}>
                    <Clock size={12} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {articulo.minutos} min
                </span>
            </Link>
        </li>
    );
}

// Vuelve a la pantalla anterior del panel; si se entró directo, a Sesiones.
export function BotonVolverPanel() {
    const router = useRouter();
    return (
        <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft size={14} />}
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/sesiones"))}
        >
            Volver al panel
        </Button>
    );
}

export default function CentroAprendizaje() {

    const [consulta, setConsulta] = useState("");
    const resultados = useMemo(() => buscarArticulos(consulta), [consulta]);
    const buscando = consulta.trim().length > 0;

    const primeros = articulosDe(PRIMEROS_PASOS);
    const categorias = CATEGORIAS.filter(c => c.id !== PRIMEROS_PASOS);

    return (

        <div className={styles.page}>

            <PageHeader
                title="Aprende a usar EFAAT"
                description="Guías breves, paso a paso, para sacarle provecho al panel. Empieza por «Primeros pasos» o busca lo que necesitas."
                icon={<GraduationCap size={20} />}
                actions={<BotonVolverPanel />}
            />

            <div className={styles.stack}>

                <div className={styles.buscador} role="search">
                    <Input
                        type="search"
                        label="Buscar en las guías"
                        placeholder="Ej.: código QR, compartir, historial"
                        leftIcon={<Search size={15} />}
                        value={consulta}
                        onChange={(e) => setConsulta(e.target.value)}
                    />
                </div>

                {buscando ? (

                    <section aria-live="polite">
                        <h2 className={styles.seccionTitulo}>
                            {resultados.length === 1 ? "1 guía encontrada" : `${resultados.length} guías encontradas`}
                        </h2>
                        {resultados.length === 0 ? (
                            <EmptyState
                                icon={<SearchX size={20} />}
                                title="No encontramos guías con esa búsqueda"
                                description="Prueba con otra palabra, por ejemplo «sesión», «QR», «tabla» o «pago»."
                                action={<Button variant="secondary" size="sm" onClick={() => setConsulta("")}>Limpiar búsqueda</Button>}
                            />
                        ) : (
                            <ul className={styles.lista}>
                                {resultados.map((a) => <TarjetaArticulo key={a.slug} articulo={a} conCategoria />)}
                            </ul>
                        )}
                    </section>

                ) : (

                    <>

                        <section aria-labelledby="primeros-pasos">
                            <h2 id="primeros-pasos" className={styles.seccionTitulo}>Primeros pasos</h2>
                            <ul className={styles.lista}>
                                {primeros.map((a) => <TarjetaArticulo key={a.slug} articulo={a} />)}
                            </ul>
                        </section>

                        <section aria-labelledby="categorias">
                            <h2 id="categorias" className={styles.seccionTitulo}>Guías por sección</h2>
                            <div className={styles.grid}>
                                {categorias.map((c) => {
                                    const articulos = articulosDe(c.id);
                                    return (
                                        <Card key={c.id} padding="md" className={styles.categoria}>
                                            <div className={styles.categoriaCabecera}>
                                                <span className={styles.categoriaIcono}><IconoCategoria icono={c.icono} /></span>
                                                <h3 className={styles.categoriaTitulo}>{c.titulo}</h3>
                                            </div>
                                            <p className={styles.categoriaDesc}>{c.descripcion}</p>
                                            {articulos.length > 0 ? (
                                                <ul className={styles.lista} style={{ gap: 0 }}>
                                                    {articulos.map((a) => (
                                                        <li key={a.slug}>
                                                            <Link href={`/aprende/${a.slug}`} prefetch={false} className={styles.enlaceArticulo}>{a.titulo}</Link>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className={styles.pendiente}>Guía en preparación.</p>
                                            )}
                                            {c.seccion && (
                                                <Link href={c.seccion.href} prefetch={false} className={styles.enlace}>{c.seccion.texto}</Link>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>

                        <p className={styles.pendiente}>{ARTICULOS.length} guías disponibles.</p>

                    </>

                )}

            </div>

        </div>

    );

}
