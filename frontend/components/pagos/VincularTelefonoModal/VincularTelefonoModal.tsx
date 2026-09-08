"use client";

import { QrCode } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

import styles from "./VincularTelefonoModal.module.css";

interface Props {
    abierto: boolean;
    emailCuenta: string | null;
    onCerrar: () => void;
}

// Modal PREPARADO para la vinculación real (QR / código temporal), que se
// implementará cuando exista el endpoint de alta de dispositivos desde el
// panel (ver backend/pagos/README.md, fase P2). Por ahora es solo la
// cáscara visual: no genera ningún QR, no llama a ningún endpoint y no
// muestra ninguna credencial de dispositivo.
export default function VincularTelefonoModal({
    abierto,
    emailCuenta,
    onCerrar
}: Props) {

    return (

        <Modal
            open={abierto}
            onClose={onCerrar}
            size="sm"
            title="Vincular teléfono"
            description={emailCuenta ? `Cuenta: ${emailCuenta}` : undefined}
            footer={<Button onClick={onCerrar}>Entendido</Button>}
        >
            <div className={styles.body}>

                <div className={styles.qr}>
                    <QrCode size={40} strokeWidth={1.25} />
                    <span>Código QR próximamente</span>
                </div>

                <p className={styles.text}>
                    Aquí aparecerá un código QR o un código temporal para vincular tu teléfono
                    con esta cuenta EFAAT, una vez que instales la aplicación.
                </p>

                <p className={styles.hint}>Esta función todavía no está disponible.</p>

            </div>
        </Modal>

    );

}
