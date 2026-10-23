"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleHelp, ExternalLink } from "lucide-react";

import { Button, Modal } from "@/components/ui";
import { articuloPorSlug } from "@/lib/aprende/articulos";

import ContenidoArticulo from "./ContenidoArticulo";
import styles from "./Aprende.module.css";

interface Props {
    // Artículo de lib/aprende/articulos.ts que explica esta pantalla.
    slug: string;
    etiqueta?: string;
}

// Ayuda contextual reutilizable: abre la guía en una ventana sobre la
// pantalla actual, sin navegar (el usuario no pierde lo que estaba haciendo).
// «Ver todas las guías» abre el centro en una pestaña nueva.
export default function AyudaContextual({ slug, etiqueta = "Ayuda" }: Props) {

    const [abierta, setAbierta] = useState(false);
    const articulo = articuloPorSlug(slug);

    if (!articulo) return null;

    return (

        <>

            <Button
                variant="ghost"
                size="sm"
                leftIcon={<CircleHelp size={15} />}
                onClick={() => setAbierta(true)}
                aria-haspopup="dialog"
                title={`Guía: ${articulo.titulo}`}
            >
                {etiqueta}
            </Button>

            <Modal
                open={abierta}
                onClose={() => setAbierta(false)}
                size="lg"
                title={articulo.titulo}
                description={articulo.descripcion}
                footer={
                    <>
                        <Link href="/aprende" prefetch={false} target="_blank" rel="noopener" className={styles.enlace}>
                            Ver todas las guías <ExternalLink size={13} aria-hidden="true" />
                        </Link>
                        <Button variant="secondary" onClick={() => setAbierta(false)}>Cerrar</Button>
                    </>
                }
            >
                <ContenidoArticulo articulo={articulo} nivel="h3" />
            </Modal>

        </>

    );

}
