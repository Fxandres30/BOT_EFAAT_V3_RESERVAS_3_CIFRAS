const obtenerContexto =
require("../middleware/obtenerContexto");

const eventHandler =
require("./eventHandler");

const commandHandler =
require("./commandHandler");

module.exports = async (
    sock,
    message
) => {

    const ctx =
        await obtenerContexto(
            sock,
            message
        );

    if (!ctx)
        return;

    await eventHandler(ctx);

    await commandHandler(ctx);

};