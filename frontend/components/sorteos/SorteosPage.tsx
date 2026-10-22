"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button, PageHeader, Tabs } from "@/components/ui";
import { apiSorteos, describirError, type CuentaPago, type Plantilla, type Sorteo, type SorteoActivo } from "@/services/sorteos/apiSorteos";

import FormularioSorteo from "./FormularioSorteo";
import VistaPreviaModal from "./VistaPreviaModal";
import ListaSorteos from "./ListaSorteos";
import ListaActivos from "./ListaActivos";
import EditarSorteoActivoModal from "./EditarSorteoActivoModal";
import PlantillasPanel from "./PlantillasPanel";
import CuentasPanel from "./CuentasPanel";
import styles from "./Sorteos.module.css";

type Pestana = "en_curso" | "programados" | "plantillas" | "cuentas";

export default function SorteosPage() {

    const [pestana, setPestana] = useState<Pestana>("programados");
    const [sorteos, setSorteos] = useState<Sorteo[]>([]);
    // Sorteos en curso de cualquier origen (bot o panel).
    const [activos, setActivos] = useState<SorteoActivo[]>([]);
    const [errorActivos, setErrorActivos] = useState<string | null>(null);
    const [editandoActivo, setEditandoActivo] = useState<string | null>(null);
    const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
    const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [formulario, setFormulario] = useState<{ abierto: boolean; sorteo: Sorteo | null }>({ abierto: false, sorteo: null });
    const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

    const cargar = useCallback(async () => {

        const [s, p, c, a] = await Promise.all([apiSorteos.listar(), apiSorteos.plantillas(), apiSorteos.cuentas(), apiSorteos.activos()]);

        if (a.ok) { setActivos(a.data); setErrorActivos(null); }
        else setErrorActivos(describirError(a));

        if (!s.ok) { setError(describirError(s)); return; }

        setError(null);

        // El listado trae los sorteos; el detalle (grupos) de cada uno se
        // pide aparte para mostrar el estado por grupo.
        const detalles = await Promise.all(s.data.map(x => apiSorteos.obtener(x.id)));
        setSorteos(detalles.map((d, i) => (d.ok ? d.data : s.data[i])));

        if (p.ok) setPlantillas(p.data);
        if (c.ok) setCuentas(c.data);

    }, []);

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
                title="Sorteos programados"
                description="Crea sorteos desde el panel, revisa la vista previa y prográmalos. Conviven con los sorteos que el bot detecta en los grupos."
                actions={<Button leftIcon={<Plus size={16} />} onClick={() => setFormulario({ abierto: true, sorteo: null })}>Nuevo sorteo</Button>}
            />

            {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}

            <Tabs
                value={pestana}
                onValueChange={v => setPestana(v as Pestana)}
                items={[
                    { value: "en_curso", label: `En curso (${activos.length})` },
                    { value: "programados", label: `Programados (${sorteos.length})` },
                    { value: "plantillas", label: `Plantillas (${plantillas.length})` },
                    { value: "cuentas", label: `Cuentas de pago (${cuentas.length})` }
                ]}
            />

            {pestana === "en_curso" && (
                errorActivos
                    ? <p className={`${styles.alerta} ${styles.alertaError}`} role="alert">No se pudieron cargar los sorteos en curso: {errorActivos}</p>
                    : <ListaActivos activos={activos} onEditar={setEditandoActivo} />
            )}
            {pestana === "programados" && (
                <ListaSorteos
                    sorteos={sorteos}
                    onVistaPrevia={setVistaPrevia}
                    onEditar={s => setFormulario({ abierto: true, sorteo: s })}
                    onActualizado={cargar}
                />
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

            <VistaPreviaModal
                key={vistaPrevia || "sin-vista"}
                sorteoId={vistaPrevia}
                onClose={() => { setVistaPrevia(null); cargar(); }}
                onConfirmado={() => { setVistaPrevia(null); cargar(); }}
            />

        </div>
    );

}
