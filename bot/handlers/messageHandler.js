const commandHandler = require("./commandHandler");

module.exports = async (

    sock,

    message

) => {

    await commandHandler(

        sock,

        message

    );

};