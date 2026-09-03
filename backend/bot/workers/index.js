const {
    reservaWorker
} = require("./reservaWorker");

// Próximamente
// const { pagoWorker } = require("./pagoWorker");
// const { androidWorker } = require("./androidWorker");
// const { metaWorker } = require("./metaWorker");

function iniciarWorkers() {

    console.log("🚀 Iniciando Workers...");

    reservaWorker();

    // pagoWorker();
    // androidWorker();
    // metaWorker();

    console.log("✅ Workers iniciados");

}

module.exports = {

    iniciarWorkers

};