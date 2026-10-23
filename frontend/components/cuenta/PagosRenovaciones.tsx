"use client";

import { Info, Receipt, RefreshCw } from "lucide-react";

import { Card, EmptyState, SectionHeader } from "@/components/ui";
import { enlaceSoporte } from "@/lib/comercial/planes";
import usePerfilCuenta from "@/hooks/usePerfilCuenta";

import CuentaHeader from "./CuentaNav";
import CatalogoPlanes from "./CatalogoPlanes";
import styles from "./Cuenta.module.css";

// No existe un registro de pagos de la suscripción ni pasarela de cobro: la
// renovación se acuerda por correo (misma regla que la landing: "No
// realizamos cobros automáticos"). Los pagos de /lector-pagos son los de los
// participantes de los sorteos, no los del cliente, y no se muestran aquí.
export default function PagosRenovaciones() {

    const { perfil } = usePerfilCuenta();
    const correo = perfil?.correo || null;

    return (

        <div className={styles.page}>

            <CuentaHeader />

            <div className={styles.stack}>

                <Card padding="lg">

                    <SectionHeader title="Historial de pagos" icon={<Receipt size={16} />} />

                    <EmptyState
                        bare
                        icon={<Receipt size={20} />}
                        title="No hay pagos registrados en el panel"
                        description="Los pagos de tu plan se coordinan directamente con el equipo de EFAAT y todavía no se guardan aquí. Si necesitas un comprobante, escríbenos."
                    />

                </Card>

                <Card padding="lg">

                    <SectionHeader
                        title="Renovar mi cuenta"
                        description="La renovación se gestiona por correo con nuestro equipo."
                        icon={<RefreshCw size={16} />}
                    />

                    <p className={styles.aviso}>
                        <Info size={15} aria-hidden="true" />
                        <span>No realizamos cobros automáticos ni pedimos datos de tarjeta en el panel.</span>
                    </p>

                    <a className={styles.enlace} href={enlaceSoporte("renovacion", correo)}>
                        Solicitar renovación por correo
                    </a>

                </Card>

                <CatalogoPlanes correo={correo} />

            </div>

        </div>

    );

}
