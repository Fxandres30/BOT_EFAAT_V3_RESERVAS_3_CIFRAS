const hola = require("../commands/hola");

module.exports = async (

    sock,

    message

) => {

    await hola(

        sock,

        message

    );

};