"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import FormularioSorteo from "@/components/sorteos/FormularioSorteo";
import VistaPreviaModal from "@/components/sorteos/VistaPreviaModal";
import { esEditable } from "@/components/sorteos/ListaSorteos";
import { apiSorteos, describirError, type Sorteo } from "@/services/sorteos/apiSorteos";

interface Props {
    precio: number;
    onClose: () => void;
}

type Paso =
    | { tipo: "buscando" }
    | { tipo: "error"; mensaje: string }
    | { tipo: "formulario"; sorteo: Sorteo | null }
    | { tipo: "vista_previa"; sorteoId: string };

// Botón «Editar» de /tablas/[precio]: abre en esta misma pantalla el flujo
// REAL de anuncios de sorteos programados (FormularioSorteo + VistaPreviaModal,
// los mismos de /sorteos) — nunca un segundo sistema de anuncios. Nada se
// publica al abrirlo: guardar deja el sorteo en borrador y solo se programa
// si el admin confirma expresamente en la vista previa.
//
// Sorteo elegido: el más reciente de este precio que todavía se pueda editar;
// si ya se publicó, se abre solo su vista previa; si no hay ninguno, el
// formulario arranca vacío con el valor de esta tabla.
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
                setPaso({ tipo: "formulario", sorteo: null });
                return;
            }

            // El listado no trae los grupos: hacen falta para saber si ya se
            // publicó en alguno (mismo criterio que la lista de /sorteos).
            const detalles = await Promise.all(delPrecio.map(s => apiSorteos.obtener(s.id)));

            if (!vivo) return;

            const completos = detalles.map((d, i) => (d.ok ? d.data : delPrecio[i]));
            const editable = completos.find(esEditable);

            if (editable) setPaso({ tipo: "formulario", sorteo: editable });
            else setPaso({ tipo: "vista_previa", sorteoId: completos[0].id });

        }

        buscar();

        return () => { vivo = false; };

    }, [precio]);

    const textoPrecio = `$${precio.toLocaleString("es-CO")}`;

    return (
        <>
            <Modal
                open={paso.tipo === "buscando" || paso.tipo === "error"}
                onClose={onClose}
                title={`Anuncio del sorteo ${textoPrecio}`}
                size="sm"
                footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
            >
                <p>{paso.tipo === "error" ? paso.mensaje : "Cargando el sorteo de esta tabla…"}</p>
            </Modal>

            <FormularioSorteo
                key={paso.tipo === "formulario" ? `form-${paso.sorteo?.id || "nuevo"}-${paso.sorteo?.version || 0}` : "form-cerrado"}
                open={paso.tipo === "formulario"}
                sorteo={paso.tipo === "formulario" ? paso.sorteo : null}
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
