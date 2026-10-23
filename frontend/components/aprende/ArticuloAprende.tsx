import Link from "next/link";
import { ArrowLeft, Clock, FileQuestion } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/ui";
import { articuloPorSlug, categoriaPorId } from "@/lib/aprende/articulos";

import ContenidoArticulo from "./ContenidoArticulo";
import IconoCategoria from "./IconoCategoria";
import styles from "./Aprende.module.css";

const VOLVER = (
    <Link href="/aprende" prefetch={false} className={styles.volver}>
        <ArrowLeft size={14} aria-hidden="true" /> Centro de aprendizaje
    </Link>
);

export default function ArticuloAprende({ slug }: { slug: string }) {

    const articulo = articuloPorSlug(slug);

    if (!articulo) {
        return (
            <div className={styles.articuloPagina}>
                {VOLVER}
                <EmptyState
                    icon={<FileQuestion size={20} />}
                    title="No encontramos esta guía"
                    description="Puede que el enlace esté incompleto o que la guía haya cambiado de nombre."
                    action={<Link href="/aprende" prefetch={false} className={styles.enlace}>Ver todas las guías</Link>}
                />
            </div>
        );
    }

    const categoria = categoriaPorId(articulo.categoria);

    return (

        <article className={styles.articuloPagina}>

            {VOLVER}

            <div className={styles.meta}>
                {categoria && <><IconoCategoria icono={categoria.icono} size={13} /> {categoria.titulo}</>}
                <span aria-hidden="true">·</span>
                <span><Clock size={12} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {articulo.minutos} min de lectura</span>
            </div>

            <PageHeader title={articulo.titulo} description={articulo.descripcion} />

            <ContenidoArticulo articulo={articulo} />

            <div className={styles.acciones} style={{ marginTop: 24 }}>
                {articulo.seccion && (
                    <Link href={articulo.seccion.href} prefetch={false} className={styles.enlace}>{articulo.seccion.texto}</Link>
                )}
                <Link href="/aprende" prefetch={false} className={styles.enlace}>Volver al centro de aprendizaje</Link>
            </div>

        </article>

    );

}
