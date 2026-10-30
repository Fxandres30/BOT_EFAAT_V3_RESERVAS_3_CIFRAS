"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button, PageHeader } from "@/components/ui";
import { apiSorteos, describirError, type SorteoGestionado } from "@/services/sorteos/apiSorteos";
import FormularioSorteo from "./FormularioSorteo";
import VistaPreviaModal from "./VistaPreviaModal";
import ListaSorteos from "./ListaSorteos";
import DetalleSorteoModal from "./DetalleSorteoModal";
import EliminarSorteoModal from "./EliminarSorteoModal";
import AccionesCrearSorteo from "./AccionesCrearSorteo";
import { separarProgramaciones } from "./filtrosSorteos";
import styles from "./Sorteos.module.css";

// «Publicar ahora» (sorteo instantáneo): el mismo sorteo que se programa
// (formulario, vista previa, cuentas, grupos, sustitución), pero se publica
// en el momento de pulsar «Publicar ahora», con el publicador de siempre. La
// vista previa muestra la imagen que genera el SERVIDOR antes de publicar.
// Su lista es la de Programados (mismas acciones), solo con los instantáneos.
const RECIENTES = 10;

export default function SorteoInstantaneoPage() {

    // ?nuevo=1 (botón «Publicar sorteo ahora» de otras pantallas) abre el
    // formulario; luego se quita de la URL para que recargar no lo reabra.
    const params = useSearchParams();
    const router = useRouter();
    const [lista, setLista] = useState<SorteoGestionado[]>([]);
    const [verArchivados, setVerArchivados] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [formulario, setFormulario] = useState<{ abierto: boolean; sorteoId: string | null }>({ abierto: params?.get("nuevo") === "1", sorteoId: null });
    const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
    const [detalle, setDetalle] = useState<string | null>(null);
    const [eliminando, setEliminando] = useState<SorteoGestionado | null>(null);

    const cargar = useCallback(async () => {
        const r = await apiSorteos.gestion();
        if (!r.ok) { setError(describirError(r)); return; }
        setError(null);
        setLista(separarProgramaciones(r.data).instantaneos
            .sort((a, b) => new Date(b.publicar_en).getTime() - new Date(a.publicar_en).getTime()));
    }, []);

    useEffect(() => {
        async function refrescar() { await cargar(); }
        refrescar();
    }, [cargar]);

    useEffect(() => {
        if (params?.get("nuevo") === "1") router.replace("/sorteo-instantaneo", { scroll: false });
    }, [params, router]);

    const vigentes = lista.filter(s => !s.archivado_en).slice(0, RECIENTES);
    const archivadas = lista.filter(s => s.archivado_en);

    return (
        <div className={`${styles.page} ${styles.stack}`}>

            <PageHeader
                title="Publicar ahora"
                description="Publica un sorteo en tus grupos AHORA, sin programarlo: revisa el anuncio y la imagen real que enviará el servidor, y confírmalo con «Publicar ahora». Para publicarlo más tarde, usa «Programar sorteo»."
                actions={<AccionesCrearSorteo onPublicarAhora={() => setFormulario({ abierto: true, sorteoId: null })} />}
            />

            <div className={`${styles.alerta} ${styles.alertaInfo}`}>
                <p><b>Cómo funciona:</b> completa lotería, fecha, hora, valor, premios, cuentas y grupos → en la vista previa ves el anuncio y la imagen generada por el servidor → «Publicar ahora» la envía con el texto a los grupos elegidos.</p>
                <p>Si un grupo ya tiene un sorteo abierto, no se publica ahí salvo que marques «Sustituir el sorteo activo» (se cierra solo en ese grupo; sus reservas y pagos se conservan).</p>
                <p>Una vez publicado, el sorteo se administra en <Link href="/eventos" className={styles.enlace}>Eventos</Link> junto a los demás.</p>
            </div>

            {error && <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">{error}</p>}
            {aviso && <p className={`${styles.alerta} ${styles.alertaAviso}`} role="status">{aviso}</p>}

            <h2 className={styles.seccionTitulo}>{verArchivados ? "Sorteos instantáneos archivados" : "Últimos sorteos instantáneos"}</h2>

            {(archivadas.length > 0 || verArchivados) && (
                <div className={styles.acciones}>
                    <Button size="sm" variant={verArchivados ? "secondary" : "ghost"} onClick={() => setVerArchivados(v => !v)}>
                        {verArchivados ? "Ver los últimos" : `Ver archivados (${archivadas.length})`}
                    </Button>
                </div>
            )}

            {!error && (
                <ListaSorteos
                    key={verArchivados ? "archivadas" : "vigentes"}
                    sorteos={verArchivados ? archivadas : vigentes}
                    archivados={verArchivados}
                    vacio={verArchivados ? undefined : { titulo: "Todavía no has publicado sorteos instantáneos", descripcion: "Pulsa «Publicar sorteo ahora» para crear y publicar uno en este momento." }}
                    onVistaPrevia={setVistaPrevia}
                    onEditar={s => setFormulario({ abierto: true, sorteoId: s.id })}
                    onDetalle={setDetalle}
                    onEliminar={s => { setAviso(null); setEliminando(s); }}
                    onActualizado={cargar}
                />
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

            {detalle && <DetalleSorteoModal key={detalle} sorteoId={detalle} onClose={() => setDetalle(null)} />}

            {eliminando && (
                <EliminarSorteoModal
                    key={eliminando.id}
                    sorteo={eliminando}
                    onClose={() => setEliminando(null)}
                    onHecho={m => { setAviso(m); setEliminando(null); cargar(); }}
                />
            )}

            <VistaPreviaModal
                key={vistaPrevia || "sin-vista"}
                sorteoId={vistaPrevia}
                onClose={() => { setVistaPrevia(null); cargar(); }}
                onConfirmado={() => { setVistaPrevia(null); cargar(); }}
            />

        </div>
    );

}
