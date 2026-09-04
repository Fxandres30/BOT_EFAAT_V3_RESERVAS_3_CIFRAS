"use client";

import QRModal from "../../../QRModal/QRModal";
import SessionRenameModal from "../../../SessionRenameModal/SessionRenameModal";
import DeleteSessionModal from "../../../DeleteSessionModal/DeleteSessionModal";

interface Props {

    qrOpen: boolean;

    qr: string;

    sessionId: string;

    segundos: number;

    cerrarQR: () => void;

    renameOpen: boolean;

    deleteOpen: boolean;

    nombre: string;

    onCloseRename: () => void;

    onCloseDelete: () => void;

    onDeleted?: () => void;

}

export default function SessionModals({

    qrOpen,

    qr,

    sessionId,

    segundos,

    cerrarQR,

    renameOpen,

    deleteOpen,

    nombre,

    onCloseRename,

    onCloseDelete,

    onDeleted

}: Props) {

    return (

        <>

            <QRModal

                open={qrOpen}

                qr={qr}

                sessionId={sessionId}

                segundos={segundos}

                onClose={cerrarQR}

            />

            <SessionRenameModal

                open={renameOpen}

                sessionId={sessionId}

                nombreActual={nombre}

                onClose={onCloseRename}

            />

            <DeleteSessionModal

                open={deleteOpen}

                sessionId={sessionId}

                nombre={nombre}

                onClose={onCloseDelete}

                onDeleted={onDeleted}

            />

        </>

    );

}