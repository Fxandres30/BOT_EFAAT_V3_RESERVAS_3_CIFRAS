package com.efaat.paymentsreader.parser

/**
 * Helpers de extracción compartidos entre parsers de distintos
 * proveedores — NO son una fuente de verdad de formato único, cada
 * parser decide qué patrones aplicar a SU texto. Esto solo evita
 * duplicar las expresiones regulares más comunes (formato de moneda
 * colombiano, referencias bancarias típicas).
 *
 * Cualquier extracción que falle devuelve null — nunca se inventa un
 * valor por defecto.
 */
object ExtraccionUtils {

    // "$25.000", "$ 1.250.000", "$25.000,50", "COP 25000" — formato
    // colombiano: punto como separador de miles, coma como decimal.
    private val PATRON_VALOR = Regex(
        """(?:\$|COP)\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]+)?|[0-9]+(?:,[0-9]+)?)""",
        RegexOption.IGNORE_CASE
    )

    private val PATRON_REFERENCIA = Regex(
        """(?:Ref\.?|Referencia|No\.?|Nro\.?|Comprobante)\s*:?\s*([A-Za-z0-9\-]{4,})""",
        RegexOption.IGNORE_CASE
    )

    // "de JUAN PEREZ" -> "JUAN PEREZ". Best-effort: se corta al llegar a
    // un separador típico (punto, coma, salto de línea) o a la palabra
    // "Ref"/"Nro". Si el texto no calza con este patrón, devuelve null —
    // preferible a extraer un nombre incorrecto.
    private val PATRON_REMITENTE = Regex(
        """\bde\s+([A-ZÁÉÍÓÚÑ][\p{L}\s]{2,40}?)(?=\s*(?:[.,]|\n|Ref\.?|Referencia|Nro\.?|$))""",
        RegexOption.IGNORE_CASE
    )

    fun extraerValor(texto: String): Double? {

        val coincidencia = PATRON_VALOR.find(texto) ?: return null

        val crudo = coincidencia.groupValues[1]
            .replace(".", "")   // separador de miles
            .replace(",", ".")  // separador decimal -> formato Double

        return crudo.toDoubleOrNull()

    }

    fun extraerReferencia(texto: String): String? {

        return PATRON_REFERENCIA.find(texto)?.groupValues?.get(1)?.trim()

    }

    fun extraerRemitente(texto: String): String? {

        return PATRON_REMITENTE.find(texto)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotBlank() }

    }
}
