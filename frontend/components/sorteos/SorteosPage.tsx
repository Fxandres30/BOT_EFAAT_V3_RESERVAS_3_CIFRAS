"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button, PageHeader, Tabs } from "@/components/ui";
import { apiSorteos, describirError, type CuentaPago, type Plantilla, type SorteoGestionado } from "@/services/sorteos/apiSorteos";
import { enlaceAdministrar } from "@/components/eventos/estadoEvento";

import FormularioSorteo from "./FormularioSorteo";
import VistaPreviaModal from "./VistaPreviaModal";
import ListaSorteos from "./ListaSorteos";
import DetalleSorteoModal from "./DetalleSorteoModal";
import EliminarSorteoModal from "./EliminarSorteoModal";
import PlantillasPanel from "./PlantillasPanel";
import CuentasPanel from "./CuentasPanel";
import AccionesCrearSorteo from "./AccionesCrearSorteo";
import { separarProgramaciones } from "./filtrosSorteos";
import styles from "./Sorteos.module.css";

type Pestana = "programados" | "plantillas" | "cuentas";

// «Programados»: sorteos que se publican más tarde (fecha y hora), con sus
// plantillas y cuentas de pago. Los instantáneos están en «Publicar ahora» y
// los sorteos ya en los grupos se administran en Eventos.
export default function SorteosPage() {

    // La antigua pestaña «Administrar» (y «En curso») vive ahora en Eventos:
    // /sorteos?vista=administrar&sorteo=<evento> redirige a /eventos?sorteo=.
    // ?nuevo=1 (botón «Programar sorteo» de otras pantallas) abre el formulario.
    const params = useSearchParams();
    const router = useRouter();
    const vista = params?.get("vista");
    const redirigir = vista === "administrar" || vista === "en_curso";
    const [pestana, setPestana] = useState<Pestana>("programados");
    const [sorteos, setSorteos] = useState<SorteoGestionado[]>([]);
    const [verArchivados, setVerArchivados] = useState(false);
    const [detalle, setDetalle] = useState<string | null>(null);
    const [eliminando, setEliminando] = useState<SorteoGestionado | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [formulario, setFormulario] = useState<{ abierto: boolean; sorteo: { id: string; version: number } | null }>({ abierto: params?.get("nuevo") === "1", sorteo: null });
    const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

    useEffect(() => {
        if (redirigir) router.replace(enlaceAdministrar(params?.get("sorteo")));
        // El formulario ya se abrió: sin ?nuevo=1, recargar no lo reabre.
        else if (params?.get("nuevo") === "1") router.replace("/sorteos", { scroll: false });
    }, [redirigir, router, params]);

    const cargar = useCallback(async () => {

        // gestion(): cada programación con sus grupos, su estado operativo y
        // las acciones que el backend permite (una sola petición).
        const [s, p, c] = await Promise.all([apiSorteos.gestion(), apiSorteos.plantillas(), apiSorteos.cuentas()]);

        if (!s.ok) { setError(describirError(s)); return; }

        setError(null);

        // Los instantáneos tienen su propia pantalla («Publicar ahora»).
        setSorteos(separarProgramaciones(s.data).programados);

        if (p.ok) setPlantillas(p.data);
        if (c.ok) setCuentas(c.data);

    }, []);

    // Archivadas: fuera de la lista principal, sin borrar nada.
    const vigentes = sorteos.filter(s => !s.archivado_en);
    const archivadas = sorteos.filter(s => s.archivado_en);

    useEffect(() => {

        if (redirigir) return;

        async function refrescar() {
            await cargar();
        }

        refrescar();

        // El publicador trabaja en segundo plano: refresco periódico del estado.
        const id = setInterval(refrescar, 30000);
        return () => clearInterval(id);

    }, [cargar, redirigir]);

    if (redirigir) return null;

    return (
        <div className={`${styles.page} ${styles.stack}`}>

            <PageHeader
                title="Sorteos programados"
                description="Crea, edita y confirma sorteos que se publican más tarde, en la fecha y hora que elijas. Cuando se publican pasan a Eventos, donde se administran junto a los demás."
                actions={<AccionesCrearSorteo onProgramar={() => setFormulario({ abierto: true, sorteo: null })} />}
            />

            <p className={`${styles.alerta} ${styles.alertaInfo}`}>
                Los sorteos que ya están en tus grupos (detectados, programados o publicados al momento) se cierran, reabren y editan en{" "}
                <Link href="/eventos" className={styles.enlace}>Eventos</Link>.
            </p>

            {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

            <Tabs
                value={pestana}
                onValueChange={v => setPestana(v as Pestana)}
                items={[
                    { value: "programados", label: `Programados (${vigentes.length})` },
                    { value: "plantillas", label: `Plantillas (${plantillas.length})` },
                    { value: "cuentas", label: `Cuentas de pago (${cuentas.length})` }
                ]}
            />

            {pestana === "programados" && (
                <>
                    {aviso && <p className={`${styles.alerta} ${styles.alertaAviso}`} role="status">{aviso}</p>}
                    {(archivadas.length > 0 || verArchivados) && (
                        <div className={styles.acciones}>
                            <Button size="sm" variant={verArchivados ? "secondary" : "ghost"} onClick={() => setVerArchivados(v => !v)}>
                                {verArchivados ? "Ver programaciones vigentes" : `Ver archivadas (${archivadas.length})`}
                            </Button>
                        </div>
                    )}
                    <ListaSorteos
                        key={verArchivados ? "archivadas" : "vigentes"}
                        sorteos={verArchivados ? archivadas : vigentes}
                        archivados={verArchivados}
                        onVistaPrevia={setVistaPrevia}
                        onEditar={s => setFormulario({ abierto: true, sorteo: s })}
                        onDetalle={setDetalle}
                        onEliminar={s => { setAviso(null); setEliminando(s); }}
                        onActualizado={cargar}
                    />
                </>
            )}

            {pestana === "plantillas" && <PlantillasPanel plantillas={plantillas} onActualizado={cargar} />}
            {pestana === "cuentas" && <CuentasPanel cuentas={cuentas} onActualizado={cargar} />}

            <FormularioSorteo
                key={formulario.abierto ? `form-${formulario.sorteo?.id || "nuevo"}-${formulario.sorteo?.version || 0}` : "form-cerrado"}
                open={formulario.abierto}
                sorteoId={formulario.sorteo?.id || null}
                onClose={() => setFormulario({ abierto: false, sorteo: null })}
                onGuardado={s => {
                    setFormulario({ abierto: false, sorteo: null });
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
