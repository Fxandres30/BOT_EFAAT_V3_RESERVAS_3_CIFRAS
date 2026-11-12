"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Ticket } from "lucide-react";

import { Aviso, Button, Field, Input, Modal, PageHeader, Select, Skeleton, avisar } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { getUser } from "@/services/auth/getUser";
import { apiRifas, mensajeMotivo, type GrupoRifa, type ModoMotor, type NumeroRifa, type RifaDetalle as Rifa } from "@/services/rifas/apiRifas";
import { apiSorteos, type GrupoAutorizado } from "@/services/sorteos/apiSorteos";

import styles from "./Rifas.module.css";

const ETIQUETA: Record<NumeroRifa["estado"], string> = {
    libre: "Libre", reservado: "Reservado", en_proceso: "En proceso", pagado: "Pagado", bloqueado: "Bloqueado"
};

// Una rifa: sus números, sus operaciones y sus grupos. Todo por tabla_id;
// nada de lo que se hace aquí toca otra rifa, aunque tenga el mismo precio.
export default function RifaDetalle({ tablaId }: { tablaId: string }) {

    const [rifa, setRifa] = useState<Rifa | null>(null);
    const [numeros, setNumeros] = useState<NumeroRifa[] | null>(null);
    const [grupos, setGrupos] = useState<GrupoRifa[]>([]);
    const [modo, setModo] = useState<ModoMotor | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
    const [ocupado, setOcupado] = useState(false);
    const [dialogo, setDialogo] = useState<"reservar" | "reiniciar" | null>(null);

    const cargar = useCallback(async () => {
        const r = await apiRifas.obtener(tablaId);
        if (!r.ok) { setError(mensajeMotivo(r.motivo)); setNumeros([]); return; }
        setError(null);
        setRifa(r.rifa);
        setNumeros(r.numeros);
        setGrupos(r.grupos);
        setModo(r.modo);
    }, [tablaId]);

    // Carga inicial: los setState ocurren al responder el servidor (asíncronos).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { cargar(); }, [cargar]);

    // Tiempo real: cambios de los números de ESTA rifa (la RLS solo entrega
    // los del cliente). Varios avisos seguidos = una relectura.
    const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        let canal: ReturnType<typeof supabase.channel> | null = null;
        let vivo = true;
        (async () => {
            const { data } = await getUser();
            if (!vivo || !data.user) return;
            canal = supabase
                .channel(`rifa-${tablaId}`)
                .on("postgres_changes", { event: "*", schema: "public", table: "numeros_rifa", filter: `tabla_id=eq.${tablaId}` }, () => {
                    if (espera.current) clearTimeout(espera.current);
                    espera.current = setTimeout(() => { cargar(); }, 400);
                })
                .subscribe((estado) => { if (estado === "SUBSCRIBED") cargar(); });
        })();
        return () => {
            vivo = false;
            if (espera.current) clearTimeout(espera.current);
            if (canal) supabase.removeChannel(canal);
        };
    }, [tablaId, cargar]);

    const conteo = useMemo(() => {
        const c = { libre: 0, reservado: 0, en_proceso: 0, pagado: 0, bloqueado: 0 };
        numeros?.forEach(n => { c[n.estado]++; });
        return c;
    }, [numeros]);

    const elegidos = useMemo(() => numeros?.filter(n => seleccion.has(n.numero)) ?? [], [numeros, seleccion]);
    const operar = modo === "nuevo" && rifa?.activa && !rifa?.archivada_en;

    function alternar(numero: string) {
        setSeleccion(s => {
            const n = new Set(s);
            if (n.has(numero)) n.delete(numero); else n.add(numero);
            return n;
        });
    }

    async function ejecutar(accion: () => Promise<{ ok: boolean; motivo?: string }>, exito: string) {
        setOcupado(true);
        const r = await accion();
        setOcupado(false);
        if (r.ok) { avisar.ok(exito); setSeleccion(new Set()); } else avisar.error(mensajeMotivo(r.motivo || "error"));
        await cargar();
    }

    const lista = [...seleccion].sort();

    if (numeros === null) {
        return <div className="max-w-6xl mx-auto"><Skeleton height={420} radius={12} /></div>;
    }

    return (
        <div className="max-w-6xl mx-auto min-w-0">
            <PageHeader
                eyebrow={<Link href="/rifas" className={styles.volver}><ArrowLeft size={14} /> Mis rifas</Link>}
                icon={<Ticket size={18} />}
                title={rifa ? rifa.nombre : "Rifa"}
                description={rifa ? `$${rifa.precio.toLocaleString("es-CO")} · ${rifa.cantidad} números · vuelta ${rifa.ciclo}${rifa.codigo ? ` · código ${rifa.codigo}` : ""}` : undefined}
                actions={operar ? <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={() => setDialogo("reiniciar")}>Reiniciar esta rifa</Button> : undefined}
            />

            {error && <Aviso tono="error">{error}</Aviso>}
            {modo === "legado" && <Aviso tono="aviso">El motor de rifas independientes todavía no está activo: esta rifa se puede preparar, pero aún no vender.</Aviso>}

            <div className={styles.resumen}>
                <span>{conteo.libre} libres</span>
                <span>{conteo.reservado + conteo.en_proceso} reservados</span>
                <span>{conteo.pagado} pagados</span>
                <span>{conteo.bloqueado} bloqueados</span>
            </div>

            <div className={styles.cuadricula} data-cifras={rifa?.cifras ?? 2}>
                {numeros.map(n => (
                    <button
                        key={n.numero}
                        type="button"
                        data-numero={n.numero}
                        data-estado={n.estado}
                        data-seleccionado={seleccion.has(n.numero) ? "" : undefined}
                        className={styles.celda}
                        disabled={!operar}
                        title={n.nombre ? `${n.nombre}${n.telefono ? ` · ${n.telefono}` : ""}` : ETIQUETA[n.estado]}
                        aria-label={`Número ${n.numero}: ${ETIQUETA[n.estado]}${n.nombre ? `, ${n.nombre}` : ""}`}
                        onClick={() => alternar(n.numero)}
                    >
                        {n.numero}
                    </button>
                ))}
            </div>

            {operar && seleccion.size > 0 && (
                <div className={styles.barra} role="toolbar" aria-label="Acciones sobre los números elegidos">
                    <span>{seleccion.size} elegido{seleccion.size === 1 ? "" : "s"}: {lista.join(", ")}</span>
                    <Button size="sm" disabled={ocupado || elegidos.some(n => n.estado !== "libre")} onClick={() => setDialogo("reservar")}>Reservar</Button>
                    <Button size="sm" disabled={ocupado || !elegidos.some(n => n.estado === "reservado" || n.estado === "en_proceso")}
                        onClick={() => ejecutar(() => apiRifas.pagar(tablaId, lista, "panel"), "Pago registrado.")}>Marcar pagado</Button>
                    <Button size="sm" variant="secondary" disabled={ocupado || !elegidos.some(n => n.estado === "reservado" || n.estado === "en_proceso")}
                        onClick={() => ejecutar(() => apiRifas.liberar(tablaId, lista), "Números liberados.")}>Liberar reserva</Button>
                    <Button size="sm" variant="secondary" disabled={ocupado || !elegidos.some(n => n.estado === "pagado")}
                        onClick={() => { if (window.confirm("¿Anular el pago y liberar estos números? Queda registrado en la auditoría.")) ejecutar(() => apiRifas.liberar(tablaId, lista, { incluir_pagados: true }), "Pago anulado y números liberados."); }}>Anular pago</Button>
                    <Button size="sm" variant="secondary" disabled={ocupado || !elegidos.every(n => n.estado === "libre")}
                        onClick={() => ejecutar(() => apiRifas.bloquear(tablaId, lista), "Números bloqueados.")}>Bloquear</Button>
                    <Button size="sm" variant="secondary" disabled={ocupado || !elegidos.some(n => n.estado === "bloqueado")}
                        onClick={() => ejecutar(() => apiRifas.liberar(tablaId, lista, { incluir_bloqueados: true }), "Números desbloqueados.")}>Desbloquear</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())}>Quitar selección</Button>
                </div>
            )}

            <GruposDeRifa tablaId={tablaId} grupos={grupos} onCambio={cargar} />

            <Reservar abierto={dialogo === "reservar"} numeros={lista} onCerrar={() => setDialogo(null)}
                onReservar={async (datos) => {
                    setDialogo(null);
                    await ejecutar(() => apiRifas.reservar(tablaId, lista, datos), "Reserva guardada.");
                }} />

            {rifa && (
                <Reiniciar abierto={dialogo === "reiniciar"} rifa={rifa} ocupados={numeros.length - conteo.libre}
                    onCerrar={() => setDialogo(null)}
                    onReiniciado={() => { setDialogo(null); cargar(); }} />
            )}
        </div>
    );
}

function Reservar({ abierto, numeros, onCerrar, onReservar }: { abierto: boolean; numeros: string[]; onCerrar: () => void; onReservar: (d: { comprador: string; telefono?: string; observaciones?: string }) => void }) {
    const [comprador, setComprador] = useState("");
    const [telefono, setTelefono] = useState("");
    const [observaciones, setObservaciones] = useState("");
    return (
        <Modal open={abierto} onClose={onCerrar} title={`Reservar ${numeros.join(", ")}`}
            footer={<>
                <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
                <Button disabled={!comprador.trim()} onClick={() => onReservar({ comprador: comprador.trim(), telefono: telefono.trim() || undefined, observaciones: observaciones.trim() || undefined })}>Reservar</Button>
            </>}>
            <div className={styles.formulario}>
                <Field label="Nombre" htmlFor="res-nombre"><Input id="res-nombre" value={comprador} maxLength={200} onChange={e => setComprador(e.target.value)} /></Field>
                <Field label="Teléfono" htmlFor="res-tel" optional><Input id="res-tel" inputMode="tel" value={telefono} maxLength={40} onChange={e => setTelefono(e.target.value)} /></Field>
                <Field label="Observaciones" htmlFor="res-obs" optional><Input id="res-obs" value={observaciones} maxLength={1000} onChange={e => setObservaciones(e.target.value)} /></Field>
            </div>
        </Modal>
    );
}

// Reiniciar SOLO esta rifa: sus números ocupados pasan al historial (vuelta
// anterior) y queda libre. Ninguna otra rifa cambia, tenga el precio que tenga.
function Reiniciar({ abierto, rifa, ocupados, onCerrar, onReiniciado }: { abierto: boolean; rifa: Rifa; ocupados: number; onCerrar: () => void; onReiniciado: () => void }) {
    const [texto, setTexto] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function confirmar() {
        setEnviando(true);
        setError(null);
        const r = await apiRifas.reiniciar(rifa.id, texto.trim());
        setEnviando(false);
        if (!r.ok) { setError(mensajeMotivo(r.motivo)); return; }
        avisar.ok(`«${rifa.nombre}» reiniciada: ${r.archivados} número(s) pasaron al historial de la vuelta ${r.ciclo - 1}.`);
        setTexto("");
        onReiniciado();
    }
    return (
        <Modal open={abierto} onClose={onCerrar} bloquearCierre={enviando} title={`Reiniciar «${rifa.nombre}»`}
            description="Solo afecta a esta rifa. Tus otras rifas no cambian, aunque tengan el mismo precio."
            footer={<>
                <Button variant="secondary" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
                <Button onClick={confirmar} loading={enviando} disabled={texto.trim() !== "REINICIAR"}>Reiniciar esta rifa</Button>
            </>}>
            <div className={styles.formulario}>
                <p>
                    {ocupados > 0
                        ? `Los ${ocupados} números ocupados de esta rifa (reservados, pagados y bloqueados) se guardarán en su historial y todos quedarán libres. No se borra ningún pago: queda en el historial y en la auditoría.`
                        : "Esta rifa no tiene números ocupados: solo empieza una vuelta nueva."}
                </p>
                <Field label="Escribe REINICIAR para confirmar" htmlFor="rein-texto"><Input id="rein-texto" value={texto} onChange={e => setTexto(e.target.value)} autoComplete="off" /></Field>
                {error && <Aviso tono="error">{error}</Aviso>}
            </div>
        </Modal>
    );
}

// Grupos de WhatsApp vinculados a la rifa: el bot vende esta rifa en ellos.
function GruposDeRifa({ tablaId, grupos, onCambio }: { tablaId: string; grupos: GrupoRifa[]; onCambio: () => void }) {
    const [disponibles, setDisponibles] = useState<GrupoAutorizado[]>([]);
    const [elegido, setElegido] = useState("");
    useEffect(() => {
        apiSorteos.grupos().then(r => { if (r.ok) setDisponibles(r.data); });
    }, []);
    const nombre = (id: string) => disponibles.find(g => g.grupo_id === id)?.nombre || id;
    const libres = disponibles.filter(g => !grupos.some(v => v.grupo_id === g.grupo_id));
    async function vincular() {
        if (!elegido) return;
        const r = await apiRifas.vincularGrupo(tablaId, elegido);
        if (r.ok) { avisar.ok("Grupo vinculado a la rifa."); setElegido(""); onCambio(); } else avisar.error(mensajeMotivo(r.motivo));
    }
    async function quitar(grupoId: string) {
        const r = await apiRifas.desvincularGrupo(tablaId, grupoId);
        if (r.ok) { avisar.ok("Grupo desvinculado."); onCambio(); } else avisar.error(mensajeMotivo(r.motivo));
    }
    return (
        <section className={styles.grupos} aria-labelledby="grupos-rifa">
            <h2 id="grupos-rifa">Grupos de esta rifa</h2>
            <p className={styles.ayuda}>El bot vende esta rifa en estos grupos. Si un grupo tiene varias rifas del mismo precio, el bot no elige: pide un código o espera a que lo resuelvas.</p>
            {grupos.length === 0 ? <p>Sin grupos vinculados.</p> : (
                <ul>{grupos.map(g => (
                    <li key={g.grupo_id}>
                        {nombre(g.grupo_id)}{g.predeterminada ? " · predeterminada" : ""}
                        <Button size="sm" variant="ghost" onClick={() => quitar(g.grupo_id)}>Quitar</Button>
                    </li>
                ))}</ul>
            )}
            {libres.length > 0 && (
                <div className={styles.vincular}>
                    <Select aria-label="Grupo a vincular" value={elegido} onChange={e => setElegido(e.target.value)}>
                        <option value="">Elegir grupo…</option>
                        {libres.map(g => <option key={g.grupo_id} value={g.grupo_id}>{g.nombre || g.grupo_id}</option>)}
                    </Select>
                    <Button size="sm" disabled={!elegido} onClick={vincular}>Vincular</Button>
                </div>
            )}
        </section>
    );
}
