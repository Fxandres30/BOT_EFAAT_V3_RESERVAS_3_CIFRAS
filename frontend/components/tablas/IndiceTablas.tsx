"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, History, LayoutGrid, Radio, Ticket } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDato } from "@/lib/cache/almacen";
import { useCambiosUsuario } from "@/lib/cache/sesion";
import { supabase } from "@/lib/supabase";
import { usuarioSesionLocal } from "@/hooks/useSesion";
import { getUser } from "@/services/auth/getUser";
import { formatearMomento } from "@/services/automatizacion/estadoProgramacion";
import { estadoSorteoPrecio, type EntradaEstadoSorteo } from "@/services/tablas/estadoSorteoPrecio";
import {
    cargarIndiceSorteos,
    claveIndiceSorteos,
    ultimoUsuarioIndice,
    type FuentesIndice
} from "@/services/tablas/indiceSorteos";
import { guardarInstantanea, leerInstantanea } from "@/services/tablas/instantaneaIndice";
import { crearRecargaAgrupada } from "@/services/tablas/recargaAgrupada";
import { ordenarPorPrecio } from "@/services/tablas/resumenTabla";
import { obtenerTablasCliente, tablasClienteEnCache, type ConfiguracionTabla } from "@/services/tablas/tablasCliente";
import { apiRifas, type Rifa } from "@/services/rifas/apiRifas";
import { EVENTO_TABLAS_CAMBIADAS } from "./NuevaTablaBoton";

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
//
// Tras recargar la página (F5) la caché en memoria está vacía: se pinta la
// instantánea guardada del MISMO usuario (services/tablas/instantaneaIndice.ts,
// máx. 24 h) con un aviso de que no está confirmada, hasta que responde el
// servidor. Lo del servidor siempre la sustituye.
export default function IndiceTablas() {

    const cambiosUsuario = useCambiosUsuario();
    // Usuario de la sesión ya leída en el navegador (DashboardLayout no monta
    // nada antes): permite elegir la instantánea en el primer pintado.
    const usuarioLocal = usuarioSesionLocal();
    const [usuarioVista, setUsuarioVista] = useState<string | null>(() => usuarioLocal ?? ultimoUsuarioIndice());
    const [tablas, setTablas] = useState<ConfiguracionTabla[] | null>(() => tablasClienteEnCache(usuarioLocal ?? ultimoUsuarioIndice()) ?? null);
    const fuentes = useDato<FuentesIndice>(usuarioVista ? claveIndiceSorteos(usuarioVista) : null) ?? null;
    const [ahora, setAhora] = useState(() => new Date());
    // Motor de rifas independientes activo: sus rifas (una tarjeta por
    // rifa, con su tabla_id). null = motor de siempre (una tarjeta por precio).
    const [rifasMotor, setRifasMotor] = useState<Rifa[] | null>(null);

    // Solo la del usuario de la sesión (leerInstantanea lo exige); se vuelve
    // a elegir si cambia la cuenta.
    const instantanea = useMemo(() => leerInstantanea(usuarioLocal), [usuarioLocal, cambiosUsuario]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {

        let vivo = true;
        let canal: ReturnType<typeof supabase.channel> | null = null;
        let intervalo: ReturnType<typeof setInterval> | null = null;
        let recarga: ReturnType<typeof crearRecargaAgrupada> | null = null;

        let alCambiarTablas: (() => void) | null = null;

        const marcarHora = () => { if (vivo) setAhora(new Date()); };

        (async () => {

            const { data } = await getUser();
            const usuarioId = data.user?.id ?? null;
            if (!vivo) return;

            if (!usuarioId) { setUsuarioVista(null); setTablas([]); return; }

            setUsuarioVista(usuarioId);
            // Otro usuario que el de la caché: lo suyo (o nada) mientras se lee.
            if (usuarioId !== ultimoUsuarioIndice()) setTablas(tablasClienteEnCache(usuarioId) ?? null);

            // Revalidación en segundo plano: lo que hay en pantalla se conserva.
            cargarIndiceSorteos(usuarioId).then(marcarHora);
            obtenerTablasCliente(usuarioId).then((lista) => { if (vivo) setTablas(lista); });
            const leerRifas = () => apiRifas.listar().then((r) => {
                if (vivo) setRifasMotor(r.ok && r.modo === "nuevo" ? r.rifas.filter(x => x.activa) : null);
            });
            leerRifas();
            // Tabla creada o editada desde Reservas: aparece al momento en su sitio.
            alCambiarTablas = () => { leerRifas(); };
            window.addEventListener(EVENTO_TABLAS_CAMBIADAS, alCambiarTablas);

            const forzar = () => cargarIndiceSorteos(usuarioId, { forzar: true }).then(marcarHora);
            recarga = crearRecargaAgrupada(forzar, ESPERA_REALTIME_MS);
            intervalo = setInterval(forzar, REFRESCO_MS);

            // Cambios reales en las publicaciones (eventos_bot) del usuario.
            // Tras un corte, al volver a conectar se lee de nuevo: lo que pasó
            // mientras tanto no llegó por Realtime.
            let cortado = false;
            canal = supabase
                .channel(`indice-reservas-${usuarioId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "eventos_bot", filter: `usuario_id=eq.${usuarioId}` },
                    () => recarga?.senal()
                )
                .subscribe((estado) => {
                    if (estado === "SUBSCRIBED") {
                        if (cortado) { cortado = false; recarga?.ahora(); }
                    } else {
                        cortado = true;
                    }
                });

        })();

        const alVolverRed = () => recarga?.ahora();
        window.addEventListener("online", alVolverRed);

        return () => {
            vivo = false;
            if (intervalo) clearInterval(intervalo);
            recarga?.cancelar();
            if (canal) supabase.removeChannel(canal);
            window.removeEventListener("online", alVolverRed);
            if (alCambiarTablas) window.removeEventListener(EVENTO_TABLAS_CAMBIADAS, alCambiarTablas);
        };

    }, [cambiosUsuario]);

    // Datos del servidor útiles: al menos una fuente respondió (en memoria).
    // Tienen prioridad absoluta sobre la instantánea.
    const servidor = fuentes && (fuentes.activos !== null || fuentes.programados !== null) ? fuentes : null;
    const guardada = !servidor && instantanea && instantanea.usuarioId === usuarioVista ? instantanea : null;
    const tablasConfig = tablas ?? guardada?.tablas ?? null;

    // Tarjetas: una por precio (motor de siempre) o una por rifa (motor de
    // rifas independientes, cada una con su tabla_id y SU sorteo).
    const vistaTablas = rifasMotor
        ? rifasMotor.map(r => ({ precio: Number(r.precio), tabla: tablasConfig?.find(t => t.precio === Number(r.precio))?.tabla ?? "", tablaId: r.tabla_id as string | null }))
        : tablasConfig?.map(({ precio, tabla }) => ({ precio, tabla, tablaId: null as string | null })) ?? null;

    // Estado de cada precio, calculado una vez para el resumen y las
    // tarjetas (null = se está consultando). Siempre por valor ascendente.
    const estados = vistaTablas ? ordenarPorPrecio(vistaTablas.map(({ precio, tabla, tablaId }) => ({
        precio,
        tablaId,
        entradas: fuentes && !guardada
            ? estadoSorteoPrecio({
                precio,
                tabla,
                // Con rifas: solo los sorteos de ESTA rifa.
                activos: tablaId && fuentes.activos ? fuentes.activos.filter(a => !a.tabla_id || a.tabla_id === tablaId) : fuentes.activos,
                programados: fuentes.programados,
                ahora
            })
            : guardada?.estados.find(e => e.precio === precio)?.entradas ?? null
    }))) : null;

    const disponibles = fuentes && !guardada
        ? { activos: Boolean(fuentes.activos), programados: Boolean(fuentes.programados) }
        : guardada?.disponibles ?? null;

    // Tras cada lectura CORRECTA del servidor se guarda la instantánea (solo
    // lo que muestran las tarjetas) del usuario de la sesión.
    useEffect(() => {
        // La instantánea es por precio: con rifas independientes no se guarda.
        if (rifasMotor || !fuentes || fuentes.fallo || !tablas || !usuarioVista || usuarioVista !== usuarioSesionLocal()) return;
        const leido = new Date(fuentes.leidoEn);
        guardarInstantanea({
            usuarioId: usuarioVista,
            leidoEn: fuentes.leidoEn,
            tablas,
            estados: tablas.map(({ precio, tabla }) => ({
                precio,
                entradas: estadoSorteoPrecio({ precio, tabla, activos: fuentes.activos, programados: fuentes.programados, ahora: leido })
            })),
            disponibles: { activos: Boolean(fuentes.activos), programados: Boolean(fuentes.programados) }
        });
    }, [fuentes, tablas, usuarioVista, rifasMotor]);

    const hayCuenta = Boolean(estados?.some(({ entradas }) =>
        entradas?.some(e => e.estado === "programado" && e.publicarEn && e.publicarEn > ahora)
    ));

    useEffect(() => {
        if (!hayCuenta) return;
        const reloj = setInterval(() => setAhora(new Date()), 1000);
        return () => clearInterval(reloj);
    }, [hayCuenta]);

    if (!vistaTablas || !estados) {
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

    if (vistaTablas.length === 0) {
        return (
            <EmptyState
                icon={<Ticket size={22} />}
                title="Sin tablas configuradas"
                description="Tu cuenta no tiene tablas de números configuradas."
            />
        );
    }

    return (

        <div className={styles.indice}>

            <Resumen estados={estados} disponibles={disponibles} />

            {guardada && (
                <p className={styles.avisoGuardada} role="status" data-instantanea="">
                    <History size={14} aria-hidden="true" />
                    {fuentes?.fallo
                        ? `No se pudo validar con el servidor. Se muestra la última información guardada (actualizada ${formatearMomento(new Date(guardada.leidoEn), ahora)}), sin confirmar; se reintentará automáticamente.`
                        : `Última información guardada (actualizada ${formatearMomento(new Date(guardada.leidoEn), ahora)}), sin confirmar. Validando con el servidor…`}
                </p>
            )}

            {!guardada && fuentes?.fallo && (
                <p className={styles.avisoFallo} role="status">
                    <AlertTriangle size={14} aria-hidden="true" />
                    No se pudo actualizar el estado de los sorteos. Se muestra la última información válida; se reintentará automáticamente.
                </p>
            )}

            <div className={styles.rejilla}>
                {estados.map(({ precio, entradas, tablaId }) => (
                    <Tarjeta key={tablaId ?? precio} precio={precio} tablaId={tablaId} entradas={entradas} ahora={ahora} />
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
    && a.tablaId === b.tablaId
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
function Resumen({ estados, disponibles }: { estados: { entradas: EntradaEstadoSorteo[] | null }[]; disponibles: { activos: boolean; programados: boolean } | null }) {

    const contar = (estado: EntradaEstadoSorteo["estado"]) =>
        estados.reduce((n, { entradas }) => n + (entradas?.filter(e => e.estado === estado).length ?? 0), 0);

    const conActivo = estados.filter(({ entradas }) => entradas?.some(e => e.estado === "activo")).length;

    const cifras = [
        { etiqueta: "Tablas", valor: String(estados.length), icono: LayoutGrid, tono: styles.neutro },
        { etiqueta: "Con sorteo activo", valor: disponibles?.activos ? String(conActivo) : "—", icono: Radio, tono: styles.exito },
        { etiqueta: "Programados", valor: disponibles?.programados ? String(contar("programado")) : "—", icono: CalendarClock, tono: styles.marca },
        { etiqueta: "Requieren revisión", valor: disponibles?.programados ? String(contar("revision")) : "—", icono: AlertTriangle, tono: styles.alerta }
    ];

    return (
        <dl className={styles.resumen} aria-busy={!disponibles || undefined}>
            {cifras.map(({ etiqueta, valor, icono: Icono, tono }) => (
                <div key={etiqueta} className={`${styles.cifra} ${tono}`}>
                    <span className={styles.cifraIcono} aria-hidden="true"><Icono size={15} /></span>
                    <div className={styles.cifraTexto}>
                        <dt>{etiqueta}</dt>
                        <dd>{disponibles || etiqueta === "Tablas" ? valor : "…"}</dd>
                    </div>
                </div>
            ))}
        </dl>
    );

}
