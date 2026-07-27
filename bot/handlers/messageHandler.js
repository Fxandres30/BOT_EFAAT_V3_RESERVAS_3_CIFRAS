const dispatcher = require("./dispatcher");

module.exports = async (data) => {

    try {

        await dispatcher(data);

    } catch (error) {

        console.error("❌ Error en messageHandler:");
        console.error(error);

    }

};