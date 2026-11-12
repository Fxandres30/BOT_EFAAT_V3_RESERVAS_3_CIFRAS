"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Aviso, Button, Field, Input, Modal, Select, avisar } from "@/components/ui";
import { apiRifas, mensajeMotivo, type Rifa } from "@/services/rifas/apiRifas";

// Aviso a la pantalla de Reservas: hay que volver a leer las tablas.
export const EVENTO_TABLAS_CAMBIADAS = "efaat:tablas-cambiadas";
export const avisarTablasCambiadas = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_TABLAS_CAMBIADAS)); };

const formato = (n: number) => `$${n.toLocaleString("es-CO")}`;
const leerValor = (texto: string) => Number(texto.replace(/\D/g, ""));

// «Nueva tabla» en Reservas (motor de rifas independientes). Cualquier valor,
// también uno que ya exista: cada tabla tiene su propio tabla_id y sus
// números. Con el motor de siempre no se muestra.
export default function NuevaTablaBoton() {

    const [activo, setActivo] = useState(false);
    const [abierta, setAbierta] = useState(false);
    const [valor, setValor] = useState("");
    const [cifras, setCifras] = useState("2");
    const [existentes, setExistentes] = useState<Rifa[]>([]);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        apiRifas.modo().then(r => { if (vivo) setActivo(r.ok && r.modo === "nuevo"); });
        return () => { vivo = false; };
    }, []);

    function abrir() {
        setValor(""); setCifras("2"); setError(null); setAbierta(true);
        apiRifas.listar().then(r => setExistentes(r.ok ? r.rifas.filter(x => x.activa) : []));
    }

    const precio = leerValor(valor);
    const mismoPrecio = precio > 0 ? existentes.filter(r => Number(r.precio) === precio).length : 0;

    async function crear() {
        if (!precio || precio <= 0) { setError("Escribe el valor por número."); return; }
        setEnviando(true);
        setError(null);
        const r = await apiRifas.crearTabla(precio, Number(cifras));
        setEnviando(false);
        if (!r.ok) { setError((r as { mensaje?: string }).mensaje || mensajeMotivo(r.motivo)); return; }
        const grupos = r.vinculados > 0 ? ` Lista en ${r.vinculados} grupo${r.vinculados === 1 ? "" : "s"}.` : "";
        const sin = r.sin_vincular > 0 ? ` No se vinculó a ${r.sin_vincular} grupo${r.sin_vincular === 1 ? "" : "s"} que ya usa${r.sin_vincular === 1 ? "" : "n"} otra tabla de ${formato(precio)}.` : "";
        avisar.ok(`Tabla ${formato(precio)} creada con todos sus números libres.${grupos}${sin}`);
        setAbierta(false);
        avisarTablasCambiadas();
    }

    if (!activo) return null;

    return (
        <>
            <Button leftIcon={<Plus size={15} />} onClick={abrir}>Nueva tabla</Button>
            <Modal
                open={abierta}
                onClose={() => setAbierta(false)}
                bloquearCierre={enviando}
                title="Nueva tabla"
                description="Tendrá sus propios números, reservas, pagos e historial."
                footer={<>
                    <Button variant="secondary" onClick={() => setAbierta(false)} disabled={enviando}>Cancelar</Button>
                    <Button onClick={crear} loading={enviando}>Crear tabla</Button>
                </>}
            >
                <div className="flex flex-col gap-4">
                    <Field label="Valor por número" htmlFor="nueva-tabla-valor">
                        <Input id="nueva-tabla-valor" inputMode="numeric" value={valor} onChange={e => setValor(e.target.value)} placeholder="2500" />
                    </Field>
                    <Field label="Números" htmlFor="nueva-tabla-cifras">
                        <Select id="nueva-tabla-cifras" value={cifras} onChange={e => setCifras(e.target.value)}>
                            <option value="2">00 a 99 (100 números)</option>
                            <option value="3">000 a 999 (1.000 números)</option>
                        </Select>
                    </Field>
                    {mismoPrecio > 0 && (
                        <Aviso tono="aviso">
                            Ya tienes {mismoPrecio === 1 ? "una tabla" : `${mismoPrecio} tablas`} de {formato(precio)}. Esta será otra tabla independiente,
                            con sus propios números; no se vinculará a los grupos que ya usan la de ese valor.
                        </Aviso>
                    )}
                    {error && <Aviso tono="error">{error}</Aviso>}
                </div>
            </Modal>
        </>
    );
}
