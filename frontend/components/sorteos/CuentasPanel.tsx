"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";

import { Badge, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import { apiSorteos, describirError, type CuentaPago, type ErrorCampo } from "@/services/sorteos/apiSorteos";
import styles from "./Sorteos.module.css";

interface Props {
    cuentas: CuentaPago[];
    onActualizado: () => void;
}

const NUEVA = { nombre: "", tipo: "nequi", numero: "", titular: "", instrucciones: "" };

// Cuentas de pago del cliente. Al programar un sorteo se COPIAN: editar o
// desactivar una cuenta aquí nunca altera sorteos ya programados.
export default function CuentasPanel({ cuentas, onActualizado }: Props) {

    const [nueva, setNueva] = useState(NUEVA);
    const [errores, setErrores] = useState<ErrorCampo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const errorDe = (campo: string) => errores.find(e => e.campo === campo)?.mensaje;

    async function crear() {
        setGuardando(true);
        setErrores([]);
        setError(null);
        const r = await apiSorteos.crearCuenta({ ...nueva, titular: nueva.titular || null, instrucciones: nueva.instrucciones || null });
        setGuardando(false);
        if (!r.ok) {
            setErrores(r.errores || []);
            setError(describirError(r));
            return;
        }
        setNueva(NUEVA);
        onActualizado();
    }

    async function alternar(c: CuentaPago) {
        const r = await apiSorteos.actualizarCuenta(c.id, { activa: c.activa === false });
        if (!r.ok) setError(describirError(r));
        onActualizado();
    }

    return (
        <div className={styles.stack}>

            <Card padding="md" className={styles.tarjeta}>
                <h3 className={styles.tarjetaTitulo}>Nueva cuenta de pago</h3>
                {error && <p className={`${styles.alerta} ${styles.alertaError}`}>{error}</p>}
                <div className={styles.fila}>
                    <Input label="Nombre visible" value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} error={errorDe("nombre")} maxLength={80} placeholder="Ej.: Nequi principal" />
                    <Select label="Tipo" value={nueva.tipo} onChange={e => setNueva({ ...nueva, tipo: e.target.value })}>
                        <option value="nequi">Nequi</option>
                        <option value="daviplata">Daviplata</option>
                        <option value="bancolombia">Bancolombia</option>
                        <option value="llave">Llave</option>
                        <option value="otro">Otro</option>
                    </Select>
                    <Input label="Número o llave" value={nueva.numero} onChange={e => setNueva({ ...nueva, numero: e.target.value })} error={errorDe("numero")} maxLength={60} />
                </div>
                <div className={styles.fila}>
                    <Input label="Titular" optional value={nueva.titular} onChange={e => setNueva({ ...nueva, titular: e.target.value })} maxLength={120} />
                    <Input label="Instrucciones" optional value={nueva.instrucciones} onChange={e => setNueva({ ...nueva, instrucciones: e.target.value })} maxLength={500} />
                </div>
                <div><Button onClick={crear} loading={guardando}>Guardar cuenta</Button></div>
            </Card>

            {cuentas.length === 0
                ? <EmptyState icon={<Wallet size={28} />} title="Sin cuentas de pago" description="Crea las cuentas que quieres mostrar en tus sorteos." />
                : (
                    <div className={styles.lista}>
                        {cuentas.map(c => (
                            <Card key={c.id} padding="md" className={styles.tarjeta}>
                                <div className={styles.tarjetaCabecera}>
                                    <h3 className={styles.tarjetaTitulo}>{c.nombre}</h3>
                                    <Badge tone={c.activa === false ? "neutral" : "success"} dot>{c.activa === false ? "Inactiva" : "Activa"}</Badge>
                                </div>
                                <div className={styles.meta}>
                                    <span>{c.tipo}</span>
                                    <span>{c.numero}</span>
                                    {c.titular && <span>{c.titular}</span>}
                                </div>
                                <div><Button size="sm" variant="secondary" onClick={() => alternar(c)}>{c.activa === false ? "Activar" : "Desactivar"}</Button></div>
                            </Card>
                        ))}
                    </div>
                )}

        </div>
    );

}
