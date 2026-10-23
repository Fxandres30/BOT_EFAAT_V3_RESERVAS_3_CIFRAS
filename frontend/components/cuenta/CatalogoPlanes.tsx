import { Card, SectionHeader } from "@/components/ui";
import { PLANES, enlaceSoporte, formatearCOP, textoGrupos } from "@/lib/comercial/planes";

import styles from "./Cuenta.module.css";

// Los planes PUBLICADOS en la landing (misma fuente). Es una referencia para
// pedir un cambio de plan, no el plan del cliente.
export default function CatalogoPlanes({ correo }: { correo: string | null }) {

    return (

        <Card padding="lg">

            <SectionHeader
                title="Planes publicados"
                description="Los mismos de nuestra página principal. Para cambiar de plan, elige uno y te contactamos por correo."
            />

            <div className={styles.grid}>
                {PLANES.map((plan) => (
                    <Card key={plan.id} padding="md" className={styles.plan}>
                        <span className={styles.planNombre}>{plan.nombre}</span>
                        <span className={styles.planPrecio}>
                            {formatearCOP(plan.precioMensualCOP)} <small>COP / mes</small>
                        </span>
                        <span className={styles.filaSub}>{textoGrupos(plan.maxGrupos)}</span>
                        <a className={styles.enlace} href={enlaceSoporte("cambio_plan", correo, plan)}>
                            Solicitar este plan
                        </a>
                    </Card>
                ))}
            </div>

        </Card>

    );

}
