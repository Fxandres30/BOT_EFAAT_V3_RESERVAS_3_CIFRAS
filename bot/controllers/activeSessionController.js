const manager = require("../../services/baileys/manager");

async function setActive(req, res) {

    const { sessionId } = req.body;

    const ok = manager.setActive(sessionId);

    if (!ok) {

        return res.status(404).json({
            success: false
        });

    }

    res.json({
        success: true
    });

}

async function getActive(req, res) {

    res.json({

        success: true,

        sessionId: manager.getActiveSession()

    });

}

module.exports = {

    setActive,

    getActive

};
