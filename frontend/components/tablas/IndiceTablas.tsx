"use client";

import { memo, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, LayoutGrid, Radio, Ticket } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDato } from "@/lib/cache/almacen";
import { useCambiosUsuario } from "@/lib/cache/sesion";
import { supabase } from "@/lib/supabase";
import { getUser } from "@/services/auth/getUser";
import { estadoSorteoPrecio, type EntradaEstadoSorteo } from "@/services/tablas/estadoSorteoPrecio";
import {
    cargarIndiceSorteos,
    claveIndiceSorteos,
    ultimoUsuarioIndice,
    type FuentesIndice
} from "@/services/tablas/indiceSorteos";
import { crearRecargaAgrupada } from "@/services/tablas/recargaAgrupada";
import { ordenarPorSorteoActivo } from "@/services/tablas/resumenTabla";
import { obtenerTablasCliente, tablasClienteEnCache, type ConfiguracionTabla } from "@/services/tablas/tablasCliente";

import TarjetaPrecio from "./TarjetaPrecio";
import styles from "./IndiceTablas.module.css";

// Revalidación de respaldo: el publicador trabaja en segundo plano y no todo
// cambio llega por Realtime (la cuenta regresiva corre aparte, cada segundo).
const REFRESCO_MS = 60_000;
// Varios avisos de Realtime seguidos (una publicación en N grupos) = UNA lectura.
const ESPERA_REALTIME_MS = 1_000;

// Precios que ofrece el cliente de la sesión (tablas_cliente; sin
// configuración propia, los precios base de lib/tablasConfig.ts).
//
// Los datos viven en la caché común del panel (services/tablas/indiceSorteos.ts),
// no en el estado del componente: al abrir una tabla y volver, se pinta al
// instante lo último leído y se revalida en segundo plano, sin volver a
// «Consultando sorteo…».
export default function IndiceTablas() {

    const cambiosUsuario = useCambiosUsuario();
    const [usuarioId, setUsuarioId] = useState<string | null>(() => ultimoUsuarioIndice());
    const [tablas, setTablas] = useState<ConfiguracionTabla[] | null>(() => tablasClienteEnCache(ultimoUsuarioIndice()) ?? null);
    const fuentes = useDato<FuentesIndice>(usuarioId ? claveIndiceSorteos(usuarioId) : null) ?? null;
    const [ahora, setAhora] = useState(() => new Date());

    useEffect(() => {

        let vivo = true;
        let canal: ReturnType<typeof supabase.channel> | null = null;
        let intervalo: ReturnType<typeof setInterval> | null = null;
        let recarga: ReturnType<typeof crearRecargaAgrupada> | null = null;

        const marcarHora = () => { if (vivo) setAhora(new Date()); };

        getUser().then(async ({ data }) => {

            const id = data.user?.id ?? null;
            if (!vivo) return;

            if (!id) { setUsuarioId(null); setTablas([]); return; }

            setUsuarioId(id);
            // Otro usuario que el de la caché: lo suyo (o nada) mientras se lee.
            if (id !== ultimoUsuarioIndice()) setTablas(tablasClienteEnCache(id) ?? null);

            // Revalidación en segundo plano: lo que hay en pantalla se conserva.
            cargarIndiceSorteos(id).then(marcarHora);
            obtenerTablasCliente(id).then((lista) => { if (vivo) setTablas(lista); });

            const forzar = () => cargarIndiceSorteos(id, { forzar: true }).then(marcarHora);
            recarga = crearRecargaAgrupada(forzar, ESPERA_REALTIME_MS);
            intervalo = setInterval(forzar, REFRESCO_MS);

            // Cambios reales en las publicaciones (eventos_bot) del usuario.
            // Tras un corte, al volver a conectar se lee de nuevo: lo que pasó
            // mientras tanto no llegó por Realtime.
            let cortado = false;
            canal = supabase
                .channel(`indice-reservas-${id}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "eventos_bot", filter: `usuario_id=eq.${id}` },
                    () => recarga?.senal()
                )
                .subscribe((estado) => {
                    if (estado === "SUBSCRIBED") {
                        if (cortado) { cortado = false; recarga?.ahora(); }
                    } else {
                        cortado = true;
                    }
                });

        });

        const alVolverRed = () => recarga?.ahora();
        window.addEventListener("online", alVolverRed);

        return () => {
            vivo = false;
            if (intervalo) clearInterval(intervalo);
            recarga?.cancelar();
            if (canal) supabase.removeChannel(canal);
            window.removeEventListener("online", alVolverRed);
        };

    }, [cambiosUsuario]);

    const hayCuenta = Boolean(tablas && fuentes && tablas.some(t =>
        estadoSorteoPrecio({ precio: t.precio, tabla: t.tabla, activos: fuentes.activos, programados: fuentes.programados, ahora })
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
        entradas: fuentes ? estadoSorteoPrecio({ precio, tabla, activos: fuentes.activos, programados: fuentes.programados, ahora }) : null
    })));

    return (

        <div className={styles.indice}>

            <Resumen estados={estados} fuentes={fuentes} />

            {fuentes?.fallo && (
                <p className={styles.avisoFallo} role="status">
                    <AlertTriangle size={14} aria-hidden="true" />
                    No se pudo actualizar el estado de los sorteos. Se muestra la última información válida; se reintentará automáticamente.
                </p>
            )}

            <div className={styles.rejilla}>
                {estados.map(({ precio, entradas }) => (
                    <Tarjeta key={precio} precio={precio} entradas={entradas} ahora={ahora} />
                ))}
            </div>

        </div>

    );

}

// Una tarjeta solo se vuelve a pintar si cambia SU estado: una revalidación
// que afecta a un precio no repinta las demás. El reloj (ahora) solo importa
// a las tarjetas con cuenta regresiva (programadas).
const Tarjeta = memo(TarjetaPrecio, (a, b) =>
    a.precio === b.precio
    && mismasEntradas(a.entradas, b.entradas)
    && (a.ahora === b.ahora || !b.entradas?.some(e => e.estado === "programado"))
);

function mismasEntradas(a: EntradaEstadoSorteo[] | null, b: EntradaEstadoSorteo[] | null) {
    if (a === b) return true;
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

// Resumen de la pantalla con los mismos estados de las tarjetas. Si una
// fuente falló, su cifra no se afirma («—»), igual que en las tarjetas.
function Resumen({ estados, fuentes }: { estados: { entradas: EntradaEstadoSorteo[] | null }[]; fuentes: FuentesIndice | null }) {

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
