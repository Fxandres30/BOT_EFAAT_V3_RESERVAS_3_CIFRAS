"use client";

import { useMemo, useState } from "react";
import { Sticker, Plus, PowerOff, AlertTriangle, Trash2, ImageOff, Sparkles, Star } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";

import { useStickerPago } from "@/hooks/useStickerPago";
import { useBibliotecaStickersPago } from "@/hooks/useBibliotecaStickersPago";
import { desactivarStickerPago } from "@/services/automatizacion/stickerPago";
import { TarjetaSticker, armarGaleria } from "@/services/automatizacion/bibliotecaStickersVista";

import styles from "./StickerPagoBiblioteca.module.css";

interface Props {
    usuarioId: string | null;
}

// Sección tenant-wide: sticker de pago PREDETERMINADO (Nivel 1 —
// grupo_id=null) + su BIBLIOTECA (migración 046).
//
// - «Agregar sticker» es el mismo registro de siempre (modo de espera de 2
//   minutos + el admin lo envía por WhatsApp). El sticker nuevo pasa a ser
//   el predeterminado y el backend lo guarda en la biblioteca con su
//   imagen; los anteriores se conservan.
// - Solo el predeterminado confirma pagos (configuracion_stickers_pago,
//   sin cambios). La biblioteca es consulta y administración.
// - Los stickers ESPECÍFICOS de cada grupo siguen en StickerPagoSection.tsx
//   (ConfiguracionGrupo.tsx) y no se tocan aquí.
export default function StickerPagoPredeterminadoSection({ usuarioId }: Props) {

    const {
        estado,
        config,
        error,
        procesando,
        minutosExpiracion,
        iniciarRegistro,
        cancelarRegistro,
        desactivar,
        recargar: recargarPredeterminado
    } = useStickerPago(usuarioId, null);

    const biblioteca = useBibliotecaStickersPago(usuarioId);

    const [modalDesactivarAbierto, setModalDesactivarAbierto] = useState(false);
    const [porEliminar, setPorEliminar] = useState<TarjetaSticker | null>(null);
    const [eliminando, setEliminando] = useState(false);
    const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

    const hashPredeterminado = estado === "esperando" || estado === "configurado"
        ? config?.sticker_sha256 ?? null
        : null;

    const galeria = useMemo(
        () => armarGaleria(biblioteca.stickers, hashPredeterminado),
        [biblioteca.stickers, hashPredeterminado]
    );

    async function confirmarDesactivar() {

        await desactivar();
        setModalDesactivarAbierto(false);

    }

    async function confirmarEliminar() {

        if (!porEliminar?.sticker || !usuarioId) return;

        setEliminando(true);
        setErrorEliminar(null);

        // Si es el predeterminado, primero se desactiva (lo que usa la
        // confirmación de pagos) y solo después se borra de la biblioteca.
        if (porEliminar.esPredeterminado) {

            const { error: errorDesactivar } = await desactivarStickerPago(usuarioId, null);

            if (errorDesactivar) {
                setEliminando(false);
                setErrorEliminar("No se pudo desactivar el sticker predeterminado. No se eliminó nada.");
                return;
            }

            await recargarPredeterminado();

        }

        const ok = await biblioteca.eliminar(porEliminar.sticker);

        setEliminando(false);

        if (!ok) {
            setErrorEliminar("No se pudo eliminar el sticker. Intenta nuevamente.");
            return;
        }

        setPorEliminar(null);

    }

    if (!usuarioId) return null;

    const ocupado = procesando || estado === "cargando";

    return (

        <div className="grupo-card" style={{ marginBottom: 20 }}>

            <div className="grupo-card-nombre" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sticker size={16} /> Sticker de pago predeterminado
            </div>

            <p className="grupos-seccion-subtitulo" style={{ margin: "4px 0 10px" }}>
                Se usa automáticamente para confirmar pagos en cualquier grupo que no tenga
                su propio sticker específico.
            </p>

            {error && (
                <p className="grupos-error">
                    <AlertTriangle size={13} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                    {error}
                </p>
            )}

            {estado === "cargando" && <p className="grupos-seccion-subtitulo">Cargando…</p>}

            {estado === "esperando" && (

                <div className={styles.espera}>
                    <div style={{ marginBottom: 10 }}>
                        <StatusBadge status="pending" label="Esperando sticker..." />
                    </div>

                    <p className="grupos-seccion-subtitulo" style={{ marginBottom: 10 }}>
                        Envía ahora, desde un administrador, el sticker que quieres agregar en
                        cualquier grupo real conectado. Quedará guardado en la biblioteca y pasará
                        a ser el predeterminado; los anteriores se conservan. El registro estará
                        disponible durante {minutosExpiracion} minutos.
                    </p>

                    <Button size="sm" variant="secondary" loading={procesando} onClick={cancelarRegistro}>
                        Cancelar
                    </Button>
                </div>

            )}

            {(estado === "sin_configurar" || estado === "configurado") && (

                <div className={styles.barra}>

                    {estado === "configurado"
                        ? <StatusBadge status="active" label="Configurado" />
                        : <StatusBadge status="inactive" label="No configurado" />}

                    <div className={styles.acciones}>
                        <Button size="sm" leftIcon={<Plus size={14} />} loading={procesando} disabled={ocupado} onClick={iniciarRegistro}>
                            Agregar sticker
                        </Button>

                        {estado === "configurado" && (
                            <Button size="sm" variant="danger" leftIcon={<PowerOff size={14} />} disabled={ocupado} onClick={() => setModalDesactivarAbierto(true)}>
                                Desactivar
                            </Button>
                        )}
                    </div>

                </div>

            )}

            {/* ------------------------------ Biblioteca ------------------------------ */}

            {estado !== "cargando" && biblioteca.disponible && (

                <section className={styles.biblioteca} aria-label="Biblioteca de stickers de pago">

                    <div className={styles.bibliotecaTitulo}>
                        Biblioteca
                        {!biblioteca.cargando && <span className={styles.contador}>{galeria.length}</span>}
                    </div>

                    {biblioteca.error && (
                        <p className="grupos-error">
                            <AlertTriangle size={13} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                            {biblioteca.error}
                        </p>
                    )}

                    {biblioteca.cargando && <p className="grupos-seccion-subtitulo">Cargando biblioteca…</p>}

                    {!biblioteca.cargando && galeria.length === 0 && (
                        <p className={styles.vacia}>
                            Aún no hay stickers guardados. Usa «Agregar sticker» y envíalo por WhatsApp.
                        </p>
                    )}

                    {!biblioteca.cargando && galeria.length > 0 && (

                        <ul className={styles.galeria}>

                            {galeria.map(tarjeta => {

                                const url = tarjeta.sticker?.imagen_ruta
                                    ? biblioteca.urls[tarjeta.sticker.imagen_ruta]
                                    : undefined;

                                return (

                                    <li
                                        key={tarjeta.clave}
                                        className={`${styles.tarjeta} ${tarjeta.esPredeterminado ? styles.tarjetaPredeterminada : ""}`}
                                    >

                                        <div className={styles.vista}>

                                            {tarjeta.vista === "imagen" && url && (
                                                // Bucket privado: URL firmada temporal. El webp
                                                // animado se reproduce solo en el navegador.
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={url}
                                                    alt={tarjeta.esPredeterminado ? "Sticker predeterminado" : "Sticker guardado"}
                                                    className={styles.imagen}
                                                    loading="lazy"
                                                    decoding="async"
                                                />
                                            )}

                                            {tarjeta.vista === "imagen" && !url && (
                                                <span className={styles.sinVista}><ImageOff size={22} aria-hidden="true" />Cargando…</span>
                                            )}

                                            {tarjeta.vista === "lottie" && (
                                                <span className={styles.sinVista}>
                                                    <Sparkles size={22} aria-hidden="true" />
                                                    Animación de WhatsApp sin vista previa
                                                </span>
                                            )}

                                            {tarjeta.vista === "sin_imagen" && (
                                                <span className={styles.sinVista}>
                                                    <ImageOff size={22} aria-hidden="true" />
                                                    Sin vista previa
                                                </span>
                                            )}

                                            {tarjeta.esPredeterminado && (
                                                <span className={styles.distintivo}>
                                                    <Star size={11} aria-hidden="true" /> Predeterminado
                                                </span>
                                            )}

                                            {tarjeta.sticker?.es_animado && (
                                                <span className={styles.animado}>Animado</span>
                                            )}

                                        </div>

                                        <div className={styles.pie}>

                                            <span className={styles.fecha}>
                                                {tarjeta.registradoEn
                                                    ? new Date(tarjeta.registradoEn).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
                                                    : "Registrado antes de la biblioteca"}
                                            </span>

                                            {tarjeta.sticker && (
                                                <button
                                                    type="button"
                                                    className={styles.eliminar}
                                                    onClick={() => { setErrorEliminar(null); setPorEliminar(tarjeta); }}
                                                    disabled={biblioteca.eliminandoId === tarjeta.sticker.id}
                                                    aria-label="Eliminar sticker"
                                                    title="Eliminar sticker"
                                                >
                                                    <Trash2 size={15} aria-hidden="true" />
                                                </button>
                                            )}

                                        </div>

                                        {tarjeta.esPredeterminado && tarjeta.vista === "sin_imagen" && (
                                            <p className={styles.nota}>
                                                Vuelve a enviarlo con «Agregar sticker» para guardar su imagen.
                                            </p>
                                        )}

                                    </li>

                                );

                            })}

                        </ul>

                    )}

                </section>

            )}

            <Modal
                open={modalDesactivarAbierto}
                onClose={() => setModalDesactivarAbierto(false)}
                title="¿Desactivar sticker de pago predeterminado?"
                description="Los grupos sin sticker específico dejarán de poder confirmar pagos por sticker. El sticker seguirá guardado en la biblioteca."
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setModalDesactivarAbierto(false)} disabled={procesando}>
                            Cancelar
                        </Button>
                        <Button variant="danger" size="sm" loading={procesando} onClick={confirmarDesactivar}>
                            Desactivar
                        </Button>
                    </>
                }
            />

            <Modal
                open={!!porEliminar}
                onClose={() => { if (!eliminando) setPorEliminar(null); }}
                title={porEliminar?.esPredeterminado ? "¿Eliminar el sticker predeterminado?" : "¿Eliminar este sticker?"}
                description={porEliminar?.esPredeterminado
                    ? "Se quitará de la biblioteca y los grupos sin sticker específico dejarán de poder confirmar pagos por sticker hasta que agregues otro."
                    : "Se quitará de la biblioteca junto con su imagen. No afecta al sticker predeterminado actual."}
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setPorEliminar(null)} disabled={eliminando}>
                            Cancelar
                        </Button>
                        <Button variant="danger" size="sm" loading={eliminando} onClick={confirmarEliminar}>
                            Eliminar
                        </Button>
                    </>
                }
            >
                {errorEliminar && (
                    <p className="grupos-error">
                        <AlertTriangle size={13} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                        {errorEliminar}
                    </p>
                )}
            </Modal>

        </div>

    );

}
