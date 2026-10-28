"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { Button, PageHeader, Tabs } from "@/components/ui";
import { apiSorteos, describirError, type CuentaPago, type Plantilla, type SorteoEnGrupos, type SorteoGestionado } from "@/services/sorteos/apiSorteos";

import FormularioSorteo from "./FormularioSorteo";
import VistaPreviaModal from "./VistaPreviaModal";
import ListaSorteos from "./ListaSorteos";
import AdministrarSorteos from "./AdministrarSorteos";
import EditarSorteoActivoModal from "./EditarSorteoActivoModal";
import DetalleSorteoModal from "./DetalleSorteoModal";
import EliminarSorteoModal from "./EliminarSorteoModal";
import PlantillasPanel from "./PlantillasPanel";
import CuentasPanel from "./CuentasPanel";
import styles from "./Sorteos.module.css";

type Pestana = "administrar" | "programados" | "plantillas" | "cuentas";

export default function SorteosPage() {

    // /sorteos?vista=administrar&sorteo=<evento> abre «Administrar» con ese
    // sorteo resaltado (enlace «Administrar sorteo» de Eventos). La antigua
    // pestaña «En curso» (mismos sorteos, solo con «Editar») se unificó aquí:
    // ?vista=en_curso también abre «Administrar».
    const params = useSearchParams();
    const vista = params?.get("vista");
    const destacado = params?.get("sorteo") || null;
    const [pestana, setPestana] = useState<Pestana>(vista === "administrar" || vista === "en_curso" ? "administrar" : "programados");
    const [sorteos, setSorteos] = useState<SorteoGestionado[]>([]);
    const [verArchivados, setVerArchivados] = useState(false);
    const [detalle, setDetalle] = useState<string | null>(null);
    const [eliminando, setEliminando] = useState<SorteoGestionado | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [editandoActivo, setEditandoActivo] = useState<string | null>(null);
    // Sorteos en los grupos (activos y recientes) para cerrar, reabrir,
    // desactivar, cancelar o eliminar.
    const [enGrupos, setEnGrupos] = useState<SorteoEnGrupos[]>([]);
    const [errorEnGrupos, setErrorEnGrupos] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);
    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [formulario, setFormulario] = useState<{ abierto: boolean; sorteo: { id: string; version: number } | null }>({ abierto: false, sorteo: null });
    const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

    const cargar = useCallback(async () => {

        // gestion(): cada programación con sus grupos, su estado operativo y
        // las acciones que el backend permite (una sola petición).
        const [s, p, c, e] = await Promise.all([apiSorteos.gestion(), apiSorteos.plantillas(), apiSorteos.cuentas(), apiSorteos.eventos()]);

        setCargado(true);
        if (e.ok) { setEnGrupos(e.data); setErrorEnGrupos(null); }
        // El backend anterior no tiene /sorteos/eventos: la ruta cae en
        // /sorteos/:id y responde 404. El nuevo nunca responde 404 aquí.
        else if (e.status === 404) setErrorEnGrupos("el servidor del bot todavía ejecuta la versión anterior. Reinicia el backend (PM2) con el código nuevo para administrar los sorteos.");
        else setErrorEnGrupos(describirError(e));

        if (!s.ok) { setError(describirError(s)); return; }

        setError(null);

        setSorteos(s.data);

        if (p.ok) setPlantillas(p.data);
        if (c.ok) setCuentas(c.data);

    }, []);

    // Archivadas: fuera de la lista principal, sin borrar nada.
    const vigentes = sorteos.filter(s => !s.archivado_en);
    const archivadas = sorteos.filter(s => s.archivado_en);

    useEffect(() => {

        async function refrescar() {
            await cargar();
        }

        refrescar();

        // El publicador trabaja en segundo plano: refresco periódico del estado.
        const id = setInterval(refrescar, 30000);
        return () => clearInterval(id);

    }, [cargar]);

    return (
        <div className={`${styles.page} ${styles.stack}`}>

            <PageHeader
                title="Sorteos"
                description="Administra los sorteos de tus grupos (cerrar, reabrir, desactivar, cancelar o eliminar) y programa sorteos nuevos desde el panel. Conviven con los que EFAAT detecta en los grupos."
                actions={<Button leftIcon={<Plus size={16} />} onClick={() => setFormulario({ abierto: true, sorteo: null })}>Nuevo sorteo</Button>}
            />

            {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

            <Tabs
                value={pestana}
                onValueChange={v => setPestana(v as Pestana)}
                items={[
                    { value: "administrar", label: `Administrar (${enGrupos.length})` },
                    { value: "programados", label: `Programados (${vigentes.length})` },
                    { value: "plantillas", label: `Plantillas (${plantillas.length})` },
                    { value: "cuentas", label: `Cuentas de pago (${cuentas.length})` }
                ]}
            />

            {pestana === "administrar" && (
                <AdministrarSorteos sorteos={enGrupos} error={errorEnGrupos} cargado={cargado} destacado={destacado} onEditar={setEditandoActivo} onActualizado={cargar} />
            )}
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

            {editandoActivo && (
                <EditarSorteoActivoModal
                    key={editandoActivo}
                    eventoId={editandoActivo}
                    onClose={() => { setEditandoActivo(null); cargar(); }}
                    onGuardado={() => { setEditandoActivo(null); cargar(); }}
                />
            )}

            {detalle && <DetalleSorteoModal key={detalle} sorteoId={detalle} onClose={() => setDetalle(null)} />}

            {eliminando && (
                <EliminarSorteoModal
                    key={eliminando.id}
                    sorteo={eliminando}
                    onClose={() => setEliminando(null)}
                    onHecho={m => { setEliminando(null); setAviso(m); cargar(); }}
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
