"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import FormularioSorteo from "@/components/sorteos/FormularioSorteo";
import VistaPreviaModal from "@/components/sorteos/VistaPreviaModal";
import { esEditable } from "@/components/sorteos/ListaSorteos";
import { apiSorteos, describirError } from "@/services/sorteos/apiSorteos";

interface Props {
    precio: number;
    onClose: () => void;
}

type Paso =
    | { tipo: "buscando" }
    | { tipo: "error"; mensaje: string }
    // No hay ningún sorteo programado de este precio que se pueda editar:
    // se explica y solo se crea uno nuevo si el administrador lo pide.
    | { tipo: "sin_editable"; publicado: string | null }
    | { tipo: "formulario"; sorteoId: string | null }
    | { tipo: "vista_previa"; sorteoId: string };

// Botón «Editar» de /tablas/[precio]: abre en esta misma pantalla el flujo
// REAL de anuncios de sorteos programados (FormularioSorteo + VistaPreviaModal,
// los mismos de /sorteos) — nunca un segundo sistema de anuncios. Nada se
// publica al abrirlo: guardar deja el sorteo en borrador y solo se programa
// si el admin confirma expresamente en la vista previa.
//
// Sorteo elegido: el más reciente de este precio que todavía se pueda editar
// (el formulario lo vuelve a pedir al backend por su id). Antes, si no había
// ninguno o el detalle fallaba, se abría «Nuevo sorteo» vacío como si fuera
// la edición: ahora se explica y crear uno nuevo es una decisión explícita.
export default function AnuncioSorteoModal({ precio, onClose }: Props) {

    const [paso, setPaso] = useState<Paso>({ tipo: "buscando" });

    // AccionesTabla monta este componente cada vez que se pulsa «Editar»:
    // la búsqueda corre una vez por apertura.
    useEffect(() => {

        let vivo = true;

        async function buscar() {

            const lista = await apiSorteos.listar();

            if (!vivo) return;

            if (!lista.ok) {
                setPaso({ tipo: "error", mensaje: describirError(lista) });
                return;
            }

            const delPrecio = lista.data
                .filter(s => Number(s.config.valor) === precio && s.estado !== "cancelado")
                .sort((a, b) => new Date(b.publicar_en).getTime() - new Date(a.publicar_en).getTime());

            if (!delPrecio.length) {
                setPaso({ tipo: "sin_editable", publicado: null });
                return;
            }

            // El listado no trae los grupos: hacen falta para saber si ya se
            // publicó en alguno (mismo criterio que la lista de /sorteos). Un
            // detalle que falla NO se da por editable.
            const detalles = await Promise.all(delPrecio.map(s => apiSorteos.obtener(s.id)));

            if (!vivo) return;

            const fallo = detalles.find(d => !d.ok);
            if (fallo && !fallo.ok) {
                setPaso({ tipo: "error", mensaje: describirError(fallo) });
                return;
            }

            const completos = detalles.flatMap(d => (d.ok ? [d.data] : []));
            const editable = completos.find(esEditable);

            if (editable) setPaso({ tipo: "formulario", sorteoId: editable.id });
            else setPaso({ tipo: "sin_editable", publicado: completos[0]?.id || null });

        }

        buscar();

        return () => { vivo = false; };

    }, [precio]);

    const textoPrecio = `$${precio.toLocaleString("es-CO")}`;
    const mensajeEspera = paso.tipo === "error" ? paso.mensaje : "Cargando el sorteo de esta tabla…";

    return (
        <>
            <Modal
                open={paso.tipo === "buscando" || paso.tipo === "error" || paso.tipo === "sin_editable"}
                onClose={onClose}
                title={`Anuncio del sorteo ${textoPrecio}`}
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                        {paso.tipo === "sin_editable" && paso.publicado && (
                            <Button variant="secondary" onClick={() => setPaso({ tipo: "vista_previa", sorteoId: paso.publicado as string })}>Ver el publicado</Button>
                        )}
                        {paso.tipo === "sin_editable" && (
                            <Button onClick={() => setPaso({ tipo: "formulario", sorteoId: null })}>Crear sorteo nuevo</Button>
                        )}
                    </>
                }
            >
                {paso.tipo === "sin_editable" ? (
                    <p>
                        {paso.publicado
                            ? "El último sorteo programado de esta tabla ya se publicó: no se puede editar."
                            : "Esta tabla no tiene sorteos programados desde el panel. Los sorteos que el bot detecta en los grupos no se editan aquí."}
                        {" "}Puedes crear un sorteo nuevo para esta tabla.
                    </p>
                ) : (
                    <p role={paso.tipo === "error" ? "alert" : "status"}>{mensajeEspera}</p>
                )}
            </Modal>

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
