package com.efaat.paymentsreader.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit test JVM puro (sin dependencias de Android framework) — corre con
 * `./gradlew test`, sin emulador ni dispositivo. Cubre las reglas de
 * extracción compartidas que usan todos los parsers de proveedor.
 */
class ExtraccionUtilsTest {

    @Test
    fun `extraerValor interpreta formato colombiano con separador de miles`() {
        assertEquals(25000.0, ExtraccionUtils.extraerValor("Recibiste $25.000 de JUAN PEREZ"))
    }

    @Test
    fun `extraerValor interpreta decimales con coma`() {
        assertEquals(1250000.50, ExtraccionUtils.extraerValor("COP 1.250.000,50 recibido"))
    }

    @Test
    fun `extraerValor devuelve null si no hay ningun monto en el texto`() {
        assertNull(ExtraccionUtils.extraerValor("Tu app bancaria tiene una novedad"))
    }

    @Test
    fun `extraerReferencia reconoce el prefijo Ref`() {
        assertEquals("TEST-12345", ExtraccionUtils.extraerReferencia("Recibiste $10.000. Ref: TEST-12345"))
    }

    @Test
    fun `extraerReferencia devuelve null sin ningun patron conocido`() {
        assertNull(ExtraccionUtils.extraerReferencia("Recibiste $10.000 de un amigo"))
    }

    @Test
    fun `extraerRemitente corta en el separador correcto`() {
        assertEquals(
            "JUAN PEREZ",
            ExtraccionUtils.extraerRemitente("Recibiste $ 15.000 de JUAN PEREZ. Ref: TEST-1")
        )
    }

    @Test
    fun `extraerRemitente devuelve null si el texto no calza con el patron`() {
        assertNull(ExtraccionUtils.extraerRemitente("Recibiste $15.000 en tu cuenta"))
    }
}
