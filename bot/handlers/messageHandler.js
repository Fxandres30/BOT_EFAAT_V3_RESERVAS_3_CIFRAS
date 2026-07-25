const obtenerContexto =
require("../middleware/obtenerContexto");

const eventHandler =
require("./eventHandler");

const commandHandler =
require("./commandHandler");

module.exports = async ({
    sock,
    message,
    session
}) => {

    const ctx =
        await obtenerContexto(
            sock,
            message
        );

    if (!ctx)
        return;

    // Si quieres conservar la sesión
    ctx.session = session;

    await eventHandler(ctx);

    await commandHandler(ctx);

};