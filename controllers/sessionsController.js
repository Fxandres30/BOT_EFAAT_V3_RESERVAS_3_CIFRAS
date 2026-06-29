const baileysService = require("../services/baileysService");

async function connect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Conectar:", sessionId);

        const data = await baileysService.connect(sessionId);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function disconnect(req, res) {

    try {

        const { sessionId } = req.body;

        console.log("Desconectar:", sessionId);

        const data = await baileysService.disconnect(sessionId);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

async function status(req, res) {

    try {

        const { id } = req.params;

        const data = await baileysService.status(id);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error: error.message

        });

    }

}

module.exports = {

    connect,

    disconnect,

    status

};