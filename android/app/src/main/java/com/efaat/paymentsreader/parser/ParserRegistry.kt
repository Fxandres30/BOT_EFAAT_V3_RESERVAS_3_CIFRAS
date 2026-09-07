package com.efaat.paymentsreader.parser

/**
 * Punto único donde se registran los parsers disponibles — agregar un
 * proveedor nuevo es implementar NotificationPaymentParser y sumarlo acá,
 * sin tocar el listener ni ningún otro parser existente.
 */
class ParserRegistry(paqueteApp: String) {

    private val parsers: List<NotificationPaymentParser> = listOf(
        NequiNotificationParser(),
        BancolombiaNotificationParser(),
        DaviplataNotificationParser(),
        GenericTestNotificationParser(paqueteApp)
    )

    /** Todos los paquetes que el listener debe dejar pasar a un parser. */
    val paquetesConocidos: Set<String> = parsers.flatMap { it.paquetesSoportados }.toSet()

    fun parserPara(paquete: String): NotificationPaymentParser? =
        parsers.firstOrNull { paquete in it.paquetesSoportados }
}
