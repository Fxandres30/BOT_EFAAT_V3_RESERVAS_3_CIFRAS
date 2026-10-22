"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import FormularioSorteo from "@/components/sorteos/FormularioSorteo";
import VistaPreviaModal from "@/components/sorteos/VistaPreviaModal";
import EditarSorteoActivoModal from "@/components/sorteos/EditarSorteoActivoModal";
import { esEditable } from "@/components/sorteos/ListaSorteos";
import { apiSorteos, describirError } from "@/services/sorteos/apiSorteos";

interface Props {
    precio: number;
    onClose: () => void;
}

type Paso =
    | { tipo: "buscando" }
    | { tipo: "error"; mensaje: string }
    // Ni sorteo activo ni programado editable: se explica, y crear uno nuevo
    // es una acción aparte y explícita.
    | { tipo: "sin_editable"; publicado: string | null }
    // Sorteo EN CURSO de esta tabla (detectado por el bot o del panel).
    | { tipo: "activo"; eventoId: string }
    | { tipo: "formulario"; sorteoId: string | null }
    | { tipo: "vista_previa"; sorteoId: string };

// Botón «Editar» de /tablas/[precio]. Abre el sorteo de ESTA tabla sea cual
// sea su origen, en este orden:
//   1. el sorteo activo de la tabla y el precio (eventos_bot: lo haya
//      detectado el bot o publicado el panel) -> edición de lo que se puede
//      cambiar con el sorteo en curso;
//   2. si no hay, el sorteo programado más reciente que aún no se publicó
//      -> formulario completo (lo pide al backend por su id);
//   3. si no hay ninguno -> se explica y «Crear sorteo nuevo» es explícito.
// Si algo no carga, error con «Reintentar»: nunca un formulario vacío.
export default function AnuncioSorteoModal({ precio, onClose }: Props) {

    const [paso, setPaso] = useState<Paso>({ tipo: "buscando" });
    const [intento, setIntento] = useState(0);

    // AccionesTabla monta este componente cada vez que se pulsa «Editar»:
    // la búsqueda corre una vez por apertura (y por cada «Reintentar»).
    useEffect(() => {

        let vivo = true;

        async function buscar() {

            const [activos, lista] = await Promise.all([apiSorteos.activos(precio), apiSorteos.listar()]);

            if (!vivo) return;

            if (!activos.ok) return setPaso({ tipo: "error", mensaje: describirError(activos) });
            if (activos.data.length) return setPaso({ tipo: "activo", eventoId: activos.data[0].id });

            if (!lista.ok) return setPaso({ tipo: "error", mensaje: describirError(lista) });

            const delPrecio = lista.data
                .filter(s => Number(s.config.valor) === precio && s.estado !== "cancelado")
                .sort((a, b) => new Date(b.publicar_en).getTime() - new Date(a.publicar_en).getTime());

            if (!delPrecio.length) return setPaso({ tipo: "sin_editable", publicado: null });

            // El listado no trae los grupos: hacen falta para saber si ya se
            // publicó en alguno. Un detalle que falla NO se da por editable.
            const detalles = await Promise.all(delPrecio.map(s => apiSorteos.obtener(s.id)));

            if (!vivo) return;

            const fallo = detalles.find(d => !d.ok);
            if (fallo && !fallo.ok) return setPaso({ tipo: "error", mensaje: describirError(fallo) });

            const completos = detalles.flatMap(d => (d.ok ? [d.data] : []));
            const editable = completos.find(esEditable);

            if (editable) setPaso({ tipo: "formulario", sorteoId: editable.id });
            else setPaso({ tipo: "sin_editable", publicado: completos[0]?.id || null });

        }

        buscar();

        return () => { vivo = false; };

    }, [precio, intento]);

    const textoPrecio = `$${precio.toLocaleString("es-CO")}`;

    return (
        <>
            <Modal
                open={paso.tipo === "buscando" || paso.tipo === "error" || paso.tipo === "sin_editable"}
                onClose={onClose}
                title={`Sorteo de la tabla ${textoPrecio}`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                        {paso.tipo === "error" && (
                            <Button variant="secondary" onClick={() => { setPaso({ tipo: "buscando" }); setIntento(n => n + 1); }}>Reintentar</Button>
                        )}
                        {paso.tipo === "sin_editable" && paso.publicado && (
                            <Button variant="secondary" onClick={() => setPaso({ tipo: "vista_previa", sorteoId: paso.publicado as string })}>Ver el último publicado</Button>
                        )}
                        {paso.tipo === "sin_editable" && (
                            <Button onClick={() => setPaso({ tipo: "formulario", sorteoId: null })}>Crear sorteo nuevo</Button>
                        )}
                    </>
                }
            >
                {paso.tipo === "sin_editable" ? (
                    <p>
                        Esta tabla no tiene ningún sorteo activo ni programado pendiente de publicar.
                        {paso.publicado ? " El último sorteo programado ya se publicó y cerró." : ""}
                        {" "}Puedes crear un sorteo nuevo para esta tabla.
                    </p>
                ) : paso.tipo === "error" ? (
                    <p role="alert">No se pudo cargar el sorteo de esta tabla: {paso.mensaje}</p>
                ) : (
                    <p role="status">Cargando el sorteo de esta tabla…</p>
                )}
            </Modal>

            {paso.tipo === "activo" && (
                <EditarSorteoActivoModal
                    key={paso.eventoId}
                    eventoId={paso.eventoId}
                    onClose={onClose}
                    onGuardado={onClose}
                />
            )}

            <FormularioSorteo
                key={paso.tipo === "formulario" ? `form-${paso.sorteoId || "nuevo"}` : "form-cerrado"}
                open={paso.tipo === "formulario"}
                sorteoId={paso.tipo === "formulario" ? paso.sorteoId : null}
                valorInicial={precio}
                onClose={onClose}
                onGuardado={s => setPaso({ tipo: "vista_previa", sorteoId: s.id })}
            />

            <VistaPreviaModal
                key={paso.tipo === "vista_previa" ? paso.sorteoId : "sin-vista"}
                sorteoId={paso.tipo === "vista_previa" ? paso.sorteoId : null}
                onClose={onClose}
                onConfirmado={onClose}
            />
        </>
    );

}
