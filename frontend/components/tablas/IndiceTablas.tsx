"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, LayoutGrid, Radio, Ticket } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getUser } from "@/services/auth/getUser";
import { apiSorteos, type SorteoActivo } from "@/services/sorteos/apiSorteos";
import { estadoSorteoPrecio, type EntradaEstadoSorteo, type ProgramacionTarjeta } from "@/services/tablas/estadoSorteoPrecio";
import { ordenarPorSorteoActivo } from "@/services/tablas/resumenTabla";
import { obtenerTablasCliente, type ConfiguracionTabla } from "@/services/tablas/tablasCliente";

import TarjetaPrecio from "./TarjetaPrecio";
import styles from "./IndiceTablas.module.css";

// El publicador trabaja en segundo plano: el estado se vuelve a pedir cada
// minuto (la cuenta regresiva corre aparte, cada segundo).
const REFRESCO_MS = 60_000;

interface Fuentes { activos: SorteoActivo[] | null; programados: ProgramacionTarjeta[] | null }

// Precios que ofrece el cliente de la sesión (tablas_cliente; sin
// configuración propia, los precios base de lib/tablasConfig.ts).
export default function IndiceTablas() {

    const [tablas, setTablas] = useState<ConfiguracionTabla[] | null>(null);
    const [fuentes, setFuentes] = useState<Fuentes | null>(null);
    const [ahora, setAhora] = useState(() => new Date());

    useEffect(() => {

        let vivo = true;

        getUser().then(async ({ data }) => {
            const lista = await obtenerTablasCliente(data.user?.id);
            if (vivo) setTablas(lista);
        });

        // Sorteos del usuario del token (el backend nunca recibe un id).
        async function cargarSorteos() {
            const [activos, gestion] = await Promise.all([apiSorteos.activos(), apiSorteos.gestion()]);
            const programados = gestion.ok ? gestion : await apiSorteos.listar();
            if (!vivo) return;
            setFuentes({ activos: activos.ok ? activos.data : null, programados: programados.ok ? programados.data : null });
            setAhora(new Date());
        }

        cargarSorteos();
        const intervalo = setInterval(cargarSorteos, REFRESCO_MS);

        return () => { vivo = false; clearInterval(intervalo); };

    }, []);

    const hayCuenta = Boolean(tablas && fuentes && tablas.some(t =>
        estadoSorteoPrecio({ precio: t.precio, tabla: t.tabla, ...fuentes, ahora })
            .some(e => e.estado === "programado" && e.publicarEn && e.publicarEn > ahora)
    ));

    useEffect(() => {
        if (!hayCuenta) return;
        const reloj = setInterval(() => setAhora(new Date()), 1000);
        return () => clearInterval(reloj);
    }, [hayCuenta]);

    if (!tablas) {
        return (
            <div className={styles.rejilla} role="status" aria-label="Cargando tablas">
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className={styles.esqueleto}>
                        <Skeleton text width="45%" />
                        <Skeleton height={34} width="70%" />
                        <Skeleton text width="85%" />
                        <Skeleton text width="35%" />
                    </div>
                ))}
            </div>
        );
    }

    if (tablas.length === 0) {
        return (
            <EmptyState
                icon={<Ticket size={22} />}
                title="Sin tablas configuradas"
                description="Tu cuenta no tiene tablas de números configuradas."
            />
        );
    }

    // El estado de cada precio se calcula una vez y lo usan el resumen y
    // las tarjetas (null mientras se consultan los sorteos). Las tarjetas con
    // sorteo activo van primero; el orden se recalcula en cada refresco.
    const estados = ordenarPorSorteoActivo(tablas.map(({ precio, tabla }) => ({
        precio,
        entradas: fuentes ? estadoSorteoPrecio({ precio, tabla, ...fuentes, ahora }) : null
    })));

    return (

        <div className={styles.indice}>

            <Resumen estados={estados} fuentes={fuentes} />

            <div className={styles.rejilla}>
                {estados.map(({ precio, entradas }) => (
                    <TarjetaPrecio key={precio} precio={precio} entradas={entradas} ahora={ahora} />
                ))}
            </div>

        </div>

    );

}

// Resumen de la pantalla con los mismos estados de las tarjetas. Si una
// fuente falló, su cifra no se afirma («—»), igual que en las tarjetas.
function Resumen({ estados, fuentes }: { estados: { entradas: EntradaEstadoSorteo[] | null }[]; fuentes: Fuentes | null }) {

    const contar = (estado: EntradaEstadoSorteo["estado"]) =>
        estados.reduce((n, { entradas }) => n + (entradas?.filter(e => e.estado === estado).length ?? 0), 0);

    const conActivo = estados.filter(({ entradas }) => entradas?.some(e => e.estado === "activo")).length;

    const cifras = [
        { etiqueta: "Tablas", valor: String(estados.length), icono: LayoutGrid, tono: styles.neutro },
        { etiqueta: "Con sorteo activo", valor: fuentes?.activos ? String(conActivo) : "—", icono: Radio, tono: styles.exito },
        { etiqueta: "Programados", valor: fuentes?.programados ? String(contar("programado")) : "—", icono: CalendarClock, tono: styles.marca },
        { etiqueta: "Requieren revisión", valor: fuentes?.programados ? String(contar("revision")) : "—", icono: AlertTriangle, tono: styles.alerta }
    ];

    return (
        <dl className={styles.resumen} aria-busy={!fuentes || undefined}>
            {cifras.map(({ etiqueta, valor, icono: Icono, tono }) => (
                <div key={etiqueta} className={`${styles.cifra} ${tono}`}>
                    <span className={styles.cifraIcono} aria-hidden="true"><Icono size={15} /></span>
                    <div className={styles.cifraTexto}>
                        <dt>{etiqueta}</dt>
                        <dd>{fuentes || etiqueta === "Tablas" ? valor : "…"}</dd>
                    </div>
                </div>
            ))}
        </dl>
    );

}
