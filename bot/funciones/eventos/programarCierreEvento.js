const { programarCierre } = require("../../utils/eventoUtils");

async function programarCierreEvento(sock, evento) {

    if (!evento)
        return;

    programarCierre(

        sock,

        evento.grupo_id,

        evento.hora_cierre

    );

}

module.exports = {

    programarCierreEvento

};