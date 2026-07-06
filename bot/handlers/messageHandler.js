const eventHandler = require("./eventHandler");
const commandHandler = require("./commandHandler");

module.exports = async (sock, message) => {

    await eventHandler(sock, message);

    await commandHandler(sock, message);

};