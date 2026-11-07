"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ImageOff, Sparkles, Sticker } from "lucide-react";

import { StatusBadge } from "@/components/ui/Badge";

import { useStickerPago } from "@/hooks/useStickerPago";
import { useBibliotecaStickersPago } from "@/hooks/useBibliotecaStickersPago";
import { armarGaleria } from "@/services/automatizacion/bibliotecaStickersVista";
import { listarGruposConStickerPropio } from "@/services/automatizacion/stickerPago";

import styles from "./Automatizacion.module.css";

// Vista compacta (solo lectura) del sticker de confirmación de pagos para
// el Resumen. La administración completa vive en Grupos → «Sticker de
// confirmación de pagos» (StickerPagoPredeterminadoSection).
export default function StickerPagoResumen({ usuarioId }: { usuarioId: string }) {

    const { estado, config } = useStickerPago(usuarioId, null);
    const biblioteca = useBibliotecaStickersPago(usuarioId);
    const [propios, setPropios] = useState<number | null>(null);

    useEffect(() => {
        let vigente = true;
        listarGruposConStickerPropio(usuarioId).then(({ data }) => {
            if (vigente) setPropios(data ? data.size : null);
        });
        return () => { vigente = false; };
    }, [usuarioId]);

    const hash = estado === "configurado" || estado === "esperando" ? config?.sticker_sha256 ?? null : null;
    const actual = useMemo(
        () => armarGaleria(biblioteca.stickers, hash).find((t) => t.esPredeterminado) || null,
        [biblioteca.stickers, hash]
    );
    const url = actual?.sticker?.imagen_ruta ? biblioteca.urls[actual.sticker.imagen_ruta] : undefined;

    return (

        <section className={styles.panel} aria-labelledby="titulo-sticker-resumen">

            <div className={styles.panelCabecera}>
                <div>
                    <h2 id="titulo-sticker-resumen" className={styles.panelTitulo}><Sticker size={16} /> Sticker de confirmación de pagos</h2>
                    <p className={styles.panelDescripcion}>EFAAT lo envía para confirmar un pago aprobado.</p>
                </div>
            </div>

            <div className={styles.stickerResumen}>

                <div className={styles.stickerMiniatura}>
                    {url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={url} alt="Sticker predeterminado actual" />
                        : actual?.vista === "lottie" ? <Sparkles size={22} aria-hidden="true" /> : <ImageOff size={22} aria-hidden="true" />}
                </div>

                <div className={styles.stickerTexto}>
                    {estado === "cargando" ? (
                        <span className={styles.nota}>Cargando…</span>
                    ) : estado === "configurado" ? (
                        <StatusBadge status="active" label="Predeterminado en uso" size="sm" />
                    ) : estado === "esperando" ? (
                        <StatusBadge status="pending" label="Esperando que envíes el sticker" size="sm" />
                    ) : estado === "error" ? (
                        <StatusBadge status="warning" label="No se pudo consultar" size="sm" />
                    ) : (
                        <StatusBadge status="inactive" label="Sin sticker predeterminado" size="sm" />
                    )}
                    <span className={styles.nota}>
                        {propios === null
                            ? "Los grupos con sticker propio usan el suyo."
                            : propios === 0
                                ? "Ningún grupo tiene sticker propio: todos usan el predeterminado."
                                : `${propios} grupo${propios === 1 ? " usa" : "s usan"} su propio sticker.`}
                    </span>
                    <Link href="/automatizacion/grupos#sticker-pago" prefetch={false} className={styles.enlace}>
                        Administrar sticker <ArrowRight size={13} />
                    </Link>
                </div>

            </div>

        </section>

    );

}
