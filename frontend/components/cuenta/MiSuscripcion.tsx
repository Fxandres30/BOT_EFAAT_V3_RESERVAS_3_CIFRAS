"use client";

import { BadgeCheck, CalendarClock, Hourglass, Info, Layers } from "lucide-react";

import { Card, SectionHeader, StatCard } from "@/components/ui";
import { enlaceSoporte } from "@/lib/comercial/planes";
import usePerfilCuenta from "@/hooks/usePerfilCuenta";

import CuentaHeader from "./CuentaNav";
import CatalogoPlanes from "./CatalogoPlanes";
import styles from "./Cuenta.module.css";

// Plan, estado, vencimiento y días restantes: hoy NO existen en la base ni en
// el backend (no hay tabla de suscripciones; la contratación y la prueba
// gratuita se gestionan por correo, ver lib/comercial/planes.ts). Esta
// pantalla lo dice tal cual: no deduce el plan del catálogo ni cuenta días
// desde la creación de la cuenta.
export default function MiSuscripcion() {

    const { perfil } = usePerfilCuenta();
    const correo = perfil?.correo || null;

    const noRegistrado = <span className={styles.sinDato}>No registrado</span>;

    return (

        <div className={styles.page}>

            <CuentaHeader />

            <div className={styles.stack}>

                <p className={styles.aviso} role="status">
                    <Info size={15} aria-hidden="true" />
                    <span>
                        Tu plan y su vigencia se acuerdan directamente con el equipo de EFAAT y todavía no se
                        registran en el panel. Por eso aquí no aparece un plan, un vencimiento ni los días
                        restantes. Si necesitas confirmarlos, escríbenos.
                    </span>
                </p>

                <div className={styles.grid}>
                    <StatCard label="Plan actual" value={noRegistrado} icon={<Layers size={16} />} />
                    <StatCard label="Estado" value={noRegistrado} icon={<BadgeCheck size={16} />} />
                    <StatCard label="Vence el" value={noRegistrado} icon={<CalendarClock size={16} />} />
                    <StatCard label="Días restantes" value={noRegistrado} hint="Se calcularán con la fecha de vencimiento registrada." icon={<Hourglass size={16} />} />
                </div>

                <Card padding="lg">

                    <SectionHeader
                        title="Consultar mi plan"
                        description="Te respondemos por correo con tu plan, su estado y su vencimiento."
                    />

                    <a className={styles.enlace} href={enlaceSoporte("consulta_plan", correo)}>
                        Escribir al equipo de EFAAT
                    </a>

                </Card>

                <CatalogoPlanes correo={correo} />

            </div>

        </div>

    );

}
