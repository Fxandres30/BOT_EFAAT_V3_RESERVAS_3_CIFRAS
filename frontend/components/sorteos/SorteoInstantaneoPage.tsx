"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";

import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { apiSorteos, describirError, type SorteoGestionado } from "@/services/sorteos/apiSorteos";
import { ESTADO_GRUPO, ESTADO_PROGRAMACION } from "@/services/sorteos/estadosSorteo";

import FormularioSorteo from "./FormularioSorteo";
import VistaPreviaModal from "./VistaPreviaModal";
import { mostrarFecha } from "./fechas";
import styles from "./Sorteos.module.css";

// «Sorteo instantáneo»: el mismo sorteo que se programa (formulario, vista
// previa, cuentas, grupos, sustitución), pero se publica en el momento de
// pulsar «Publicar ahora», con el publicador de siempre. La vista previa
// muestra la imagen que genera el SERVIDOR antes de publicar.
const RECIENTES = 10;

export default function SorteoInstantaneoPage() {

    const [lista, setLista] = useState<SorteoGestionado[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [formulario, setFormulario] = useState<{ abierto: boolean; sorteoId: string | null }>({ abierto: false, sorteoId: null });
    const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        const r = await apiSorteos.gestion();
        if (!r.ok) { setError(describirError(r)); return; }
        setError(null);
        setLista(r.data
            .filter(s => s.config.publicacion_inmediata === true && !s.gestion.archivado_en)
            .sort((a, b) => new Date(b.publicar_en).getTime() - new Date(a.publicar_en).getTime())
            .slice(0, RECIENTES));
    }, []);

    useEffect(() => {
        async function refrescar() { await cargar(); }
        refrescar();
    }, [cargar]);

    return (
        <div className={`${styles.page} ${styles.stack}`}>

            <PageHeader
                title="Sorteo instantáneo"
                description="Publica un sorteo en tus grupos AHORA, sin programarlo: revisa el anuncio y la imagen real que enviará el servidor, y pulsa «Publicar ahora». Para publicarlo más tarde, prográmalo en «Sorteos»."
                actions={<Button leftIcon={<Zap size={16} />} onClick={() => setFormulario({ abierto: true, sorteoId: null })}>Nuevo sorteo instantáneo</Button>}
            />

            <div className={`${styles.alerta} ${styles.alertaInfo}`}>
                <p><b>Cómo funciona:</b> completa lotería, fecha, hora, valor, premios, cuentas y grupos → en la vista previa ves el anuncio y la imagen generada por el servidor → «Publicar ahora» la envía a cada grupo con la foto de la tabla y te muestra el resultado real de cada uno.</p>
                <p>Si un grupo ya tiene un sorteo abierto, no se publica ahí salvo que marques «Sustituir el sorteo activo» (se cierra solo en ese grupo; sus reservas y pagos se conservan).</p>
            </div>

            {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}

            <h2 className={styles.seccionTitulo}>Últimos sorteos instantáneos</h2>

            {!error && lista.length === 0 ? (
                <EmptyState icon={<Zap size={28} />} title="Todavía no has publicado sorteos instantáneos" description="Pulsa «Nuevo sorteo instantáneo» para crear y publicar uno ahora." />
            ) : (
                <div className={styles.lista}>
                    {lista.map(s => (
                        <Card key={s.id} padding="md" className={styles.tarjeta}>
                            <div className={styles.tarjetaCabecera}>
                                <h3 className={styles.tarjetaTitulo}>{s.config.nombre || "Sorteo sin nombre"}</h3>
                                <Badge tone={ESTADO_PROGRAMACION[s.estado].tono} dot>{s.estado === "borrador" ? "Sin publicar" : ESTADO_PROGRAMACION[s.estado].texto}</Badge>
                            </div>
                            <div className={styles.meta}>
                                <span>{s.estado === "borrador" ? "Creado, pendiente de publicar" : `Publicado: ${mostrarFecha(s.confirmado_en || s.publicar_en)}`}</span>
                                <span>Sorteo {s.config.fecha_sorteo?.split("-").reverse().join("/") || ""} {s.config.hora_fin} · ${Number(s.config.valor || 0).toLocaleString("es-CO")} por número</span>
                            </div>
                            <ul className={styles.grupos}>
                                {s.grupos.filter(g => g.estado !== "cancelado").map(g => (
                                    <li key={g.grupo_id} className={styles.grupo}>
                                        <Badge tone={ESTADO_GRUPO[g.estado].tono} dot>{ESTADO_GRUPO[g.estado].texto}</Badge>
                                        {g.grupo_nombre || g.grupo_id}
                                        {g.ultimo_error && g.estado !== "publicado" && <span className={g.estado === "requiere_revision" ? styles.error : styles.ayuda}>{g.ultimo_error}</span>}
                                    </li>
                                ))}
                            </ul>
                            <div className={styles.acciones}>
                                {s.estado === "borrador" ? (
                                    <>
                                        <Button size="sm" onClick={() => setVistaPrevia(s.id)}>Revisar y publicar</Button>
                                        <Button size="sm" variant="secondary" onClick={() => setFormulario({ abierto: true, sorteoId: s.id })}>Editar</Button>
                                    </>
                                ) : (
                                    <Link href="/sorteos?vista=administrar" className={styles.enlace}>Administrar en Sorteos</Link>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <FormularioSorteo
                key={formulario.abierto ? `form-${formulario.sorteoId || "nuevo"}` : "form-cerrado"}
                open={formulario.abierto}
                sorteoId={formulario.sorteoId}
                instantaneo
                onClose={() => setFormulario({ abierto: false, sorteoId: null })}
                onGuardado={s => {
                    setFormulario({ abierto: false, sorteoId: null });
                    setVistaPrevia(s.id);
                    cargar();
                }}
            />

            <VistaPreviaModal
                key={vistaPrevia || "sin-vista"}
                sorteoId={vistaPrevia}
                onClose={() => { setVistaPrevia(null); cargar(); }}
                onConfirmado={() => { setVistaPrevia(null); cargar(); }}
            />

        </div>
    );

}
