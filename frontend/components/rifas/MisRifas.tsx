"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Ticket } from "lucide-react";

import { Aviso, Button, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, avisar } from "@/components/ui";
import { apiRifas, mensajeMotivo, type AvisoRifas, type ModoMotor, type Rifa } from "@/services/rifas/apiRifas";

import styles from "./Rifas.module.css";

const formatoPrecio = (n: number) => `$${n.toLocaleString("es-CO")}`;

// «Mis rifas»: cada rifa es independiente (su tabla_id, sus números, sus
// reservas, pagos e historial). Puede haber varias del mismo precio.
export default function MisRifas() {

    const [rifas, setRifas] = useState<Rifa[] | null>(null);
    const [modo, setModo] = useState<ModoMotor | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creando, setCreando] = useState(false);
    const [avisos, setAvisos] = useState<AvisoRifas[]>([]);

    const cargar = useCallback(async () => {
        const [r, a] = await Promise.all([apiRifas.listar(), apiRifas.avisos()]);
        setAvisos(a.ok ? a.avisos : []);
        if (!r.ok) { setError(mensajeMotivo(r.motivo)); setRifas([]); return; }
        setError(null);
        setModo(r.modo);
        setRifas(r.rifas);
    }, []);

    // Carga inicial: los setState ocurren al responder el servidor (asíncronos).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { cargar(); }, [cargar]);

    return (
        <div className="max-w-6xl mx-auto min-w-0">
            <PageHeader
                eyebrow="Operación"
                icon={<Ticket size={18} />}
                title="Mis rifas"
                description="Cada rifa tiene sus propios números, reservas, pagos e historial. Reiniciar una no afecta a ninguna otra."
                actions={<Button leftIcon={<Plus size={15} />} onClick={() => setCreando(true)}>Nueva rifa</Button>}
            />

            {modo === "legado" && (
                <Aviso tono="aviso">
                    El motor de rifas independientes todavía no está activo: puedes crear tus rifas y asignarles grupos,
                    pero las reservas y los pagos siguen en las tablas anteriores hasta activarlo.
                </Aviso>
            )}
            {error && <Aviso tono="error">{error}</Aviso>}
            {modo === "nuevo" && avisos.map((a, i) => (
                <Aviso key={`${a.tipo}-${a.grupo_id}-${i}`} tono="error">{textoAviso(a)}</Aviso>
            ))}

            {rifas === null ? (
                <div className={styles.rejilla} role="status" aria-label="Cargando rifas">
                    {[0, 1, 2].map(i => <Skeleton key={i} height={132} radius={12} />)}
                </div>
            ) : rifas.length === 0 ? (
                <EmptyState title="Todavía no tienes rifas" description="Crea tu primera rifa con su precio y cantidad de números." />
            ) : (
                <div className={styles.rejilla}>
                    {rifas.map(r => (
                        <Link key={r.tabla_id} href={`/rifas/${r.tabla_id}`} className={styles.tarjeta}>
                            <div className={styles.tarjetaCabecera}>
                                <strong>{r.nombre}</strong>
                                {r.codigo && <span className={styles.codigo}>{r.codigo}</span>}
                            </div>
                            <div className={styles.precio}>{formatoPrecio(r.precio)} · {r.cantidad} números</div>
                            <div className={styles.conteos}>
                                <span>{r.libres} libres</span>
                                <span>{r.reservados} reservados</span>
                                <span>{r.pagados} pagados</span>
                            </div>
                            {!r.activa && <span className={styles.inactiva}>Inactiva</span>}
                        </Link>
                    ))}
                </div>
            )}

            <NuevaRifa abierta={creando} onCerrar={() => setCreando(false)} onCreada={() => { setCreando(false); cargar(); }} />
        </div>
    );
}

// El bot se detuvo en ese grupo y espera al administrador: nunca elige una rifa por su cuenta.
function textoAviso(a: AvisoRifas): string {
    const grupo = a.grupo_nombre || a.grupo_id;
    const precio = (v: number | null) => (v ? formatoPrecio(v) : "sin precio");
    if (a.tipo === "sorteo_sin_rifa") {
        return `En «${grupo}» hay un sorteo de ${precio(a.valor)} sin rifa asignada: el bot no está vendiendo números. Vincula al grupo la rifa de ese precio.`;
    }
    if (a.tipo === "rifa_de_otro_precio") {
        return `En «${grupo}» el sorteo de ${precio(a.valor)} está usando una rifa de ${formatoPrecio(a.precio_rifa)}. Revísalo antes de seguir vendiendo.`;
    }
    return `En «${grupo}» hay ${a.sorteos.length} sorteos en curso a la vez (${a.sorteos.map(s => precio(s.valor)).join(", ")}): el bot no responde para no mezclarlos. Cierra el que no corresponda.`;
}

function NuevaRifa({ abierta, onCerrar, onCreada }: { abierta: boolean; onCerrar: () => void; onCreada: () => void }) {

    const [nombre, setNombre] = useState("");
    const [precio, setPrecio] = useState("");
    const [cifras, setCifras] = useState("2");
    const [codigo, setCodigo] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function crear() {
        const valor = Number(precio.replace(/\D/g, ""));
        if (!nombre.trim() || !valor) { setError("Escribe el nombre y el precio."); return; }
        setEnviando(true);
        setError(null);
        const r = await apiRifas.crear({ nombre: nombre.trim(), precio: valor, cifras: Number(cifras), codigo: codigo.trim() || null });
        setEnviando(false);
        if (!r.ok) { setError(mensajeMotivo(r.motivo)); return; }
        avisar.ok(`Rifa «${nombre.trim()}» creada con todos sus números libres.`);
        setNombre(""); setPrecio(""); setCodigo("");
        onCreada();
    }

    return (
        <Modal
            open={abierta}
            onClose={onCerrar}
            bloquearCierre={enviando}
            title="Nueva rifa"
            description="Es independiente de tus otras rifas, aunque tengan el mismo precio."
            footer={<>
                <Button variant="secondary" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
                <Button onClick={crear} loading={enviando}>Crear rifa</Button>
            </>}
        >
            <div className={styles.formulario}>
                <Field label="Nombre" htmlFor="rifa-nombre"><Input id="rifa-nombre" value={nombre} maxLength={80} onChange={e => setNombre(e.target.value)} placeholder="Rifa de la tarde" /></Field>
                <Field label="Precio por número" htmlFor="rifa-precio"><Input id="rifa-precio" inputMode="numeric" value={precio} onChange={e => setPrecio(e.target.value)} placeholder="1500" /></Field>
                <Field label="Números" htmlFor="rifa-cifras">
                    <Select id="rifa-cifras" value={cifras} onChange={e => setCifras(e.target.value)}>
                        <option value="2">00 a 99 (100 números)</option>
                        <option value="3">000 a 999 (1.000 números)</option>
                    </Select>
                </Field>
                <Field label="Código" htmlFor="rifa-codigo" optional hint="Para distinguirla en WhatsApp si un grupo tiene varias rifas (por ejemplo «A»).">
                    <Input id="rifa-codigo" value={codigo} maxLength={20} onChange={e => setCodigo(e.target.value)} />
                </Field>
                {error && <Aviso tono="error">{error}</Aviso>}
            </div>
        </Modal>
    );
}
