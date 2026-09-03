export async function shareSession(
    sessionId: string
) {

    const enlace =
        `${window.location.origin}/conectar/${sessionId}`;

    try {

        await navigator.clipboard.writeText(enlace);

        alert("✅ Enlace copiado correctamente.");

    } catch (err) {

        console.error(err);

        alert("No fue posible copiar el enlace.");

    }

}