// ==========================================================================
// Controlador HTTP de /pagos — FASE P1 (ingesta cruda solamente).
//
// Mismo estilo defensivo que el resto del backend (ver
// bot/controllers/sessionsController.js): try/catch en cada handler,
// respuestas {success, ...}, nunca lanza. El código 23505
// (unique_violation) se maneja igual que en
// bot/funciones/usuarios/obtenerUsuarioGlobal.js: no es un error real,
// es la señal atómica de "ya existe" que usamos para detectar duplicados
// sin una ventana de carrera entre "buscar" e "insertar".
// ==========================================================================

const supabase = require("../lib/supabase");
const { calcularHashDuplicado } = require("./hashDuplicado");

const CODIGO_VIOLACION_UNICA_POSTGRES = "23505";

async function crearMovimiento(req, res) {

    try {

        const { usuarioId, id: dispositivoId } = req.dispositivo;

        const {
            proveedor,
            valor,
            moneda,
            fecha_hora_movimiento,
            remitente_nombre,
            remitente_cuenta,
            referencia,
            texto_original
        } = req.body || {};

        if (!proveedor || valor === undefined || valor === null || !fecha_hora_movimiento || !texto_original) {

            return res.status(400).json({
                success: false,
                code: "CAMPOS_INCOMPLETOS",
                error: "proveedor, valor, fecha_hora_movimiento y texto_original son obligatorios"
            });

        }

        const valorNumerico = Number(valor);

        if (!Number.isFinite(valorNumerico)) {

            return res.status(400).json({
                success: false,
                code: "VALOR_INVALIDO",
                error: "valor debe ser numérico"
            });

        }

        const fechaValida = new Date(fecha_hora_movimiento);

        if (Number.isNaN(fechaValida.getTime())) {

            return res.status(400).json({
                success: false,
                code: "FECHA_INVALIDA",
                error: "fecha_hora_movimiento debe ser una fecha válida (ISO 8601)"
            });

        }

        const hash = calcularHashDuplicado({
            usuarioId,
            proveedor,
            valor: valorNumerico,
            fechaHoraMovimiento: fecha_hora_movimiento,
            referencia,
            remitenteCuenta: remitente_cuenta
        });

        const filaBase = {

            usuario_id: usuarioId,
            dispositivo_id: dispositivoId,
            proveedor,
            valor: valorNumerico,
            moneda: moneda || "COP",
            fecha_hora_movimiento: fechaValida.toISOString(),
            remitente_nombre: remitente_nombre || null,
            remitente_cuenta: remitente_cuenta || null,
            referencia: referencia || null,
            texto_original,
            recibido_en: new Date().toISOString(),
            hash_duplicado: hash

        };

        // Intento optimista con estado "pendiente". El índice único parcial
        // (usuario_id, hash_duplicado) WHERE estado <> 'duplicado' (ver
        // migración 005) es lo que garantiza de forma ATÓMICA que nunca
        // queden dos filas "pendiente" independientes para el mismo
        // movimiento real — sin esto habría una ventana de carrera entre
        // "buscar si existe" e "insertar".
        const { data: insertado, error: errorInsert } = await supabase
            .from("pagos_movimientos")
            .insert({ ...filaBase, estado: "pendiente" })
            .select()
            .single();

        if (!errorInsert) {

            await actualizarUltimoMovimientoDispositivo(dispositivoId);

            return res.status(201).json({
                success: true,
                duplicado: false,
                movimiento: insertado
            });

        }

        if (errorInsert.code !== CODIGO_VIOLACION_UNICA_POSTGRES) {

            console.error("❌ [PAGOS] Error insertando movimiento:", errorInsert.message);

            return res.status(500).json({
                success: false,
                error: "Error registrando el movimiento"
            });

        }

        // Colisión real: ya existe un movimiento no-duplicado con el mismo
        // hash para este tenant. Se registra ESTE intento como duplicado,
        // enlazado al original — nunca se descarta en silencio ni se crea
        // como fila independiente.
        const { data: original, error: errorBuscarOriginal } = await supabase
            .from("pagos_movimientos")
            .select("id")
            .eq("usuario_id", usuarioId)
            .eq("hash_duplicado", hash)
            .neq("estado", "duplicado")
            .maybeSingle();

        if (errorBuscarOriginal || !original) {

            console.error(
                "❌ [PAGOS] No se pudo localizar el movimiento original tras colisión de duplicado:",
                errorBuscarOriginal?.message
            );

            return res.status(500).json({
                success: false,
                error: "Error registrando el movimiento duplicado"
            });

        }

        const { data: duplicado, error: errorInsertDuplicado } = await supabase
            .from("pagos_movimientos")
            .insert({ ...filaBase, estado: "duplicado", duplicado_de_id: original.id })
            .select()
            .single();

        if (errorInsertDuplicado) {

            console.error("❌ [PAGOS] Error insertando fila de duplicado:", errorInsertDuplicado.message);

            return res.status(500).json({
                success: false,
                error: "Error registrando el movimiento duplicado"
            });

        }

        await actualizarUltimoMovimientoDispositivo(dispositivoId);

        return res.status(200).json({
            success: true,
            duplicado: true,
            movimientoOriginalId: original.id,
            movimiento: duplicado
        });

    } catch (err) {

        console.error("❌ [PAGOS] Error inesperado en crearMovimiento:", err);

        return res.status(500).json({
            success: false,
            error: err.message
        });

    }

}

// Best-effort, nunca debe tumbar la ingesta principal (mismo patrón que
// backend/services/tablas/registrarActividad.ts del frontend).
async function actualizarUltimoMovimientoDispositivo(dispositivoId) {

    try {

        await supabase
            .from("pagos_dispositivos")
            .update({ ultimo_movimiento_en: new Date().toISOString() })
            .eq("id", dispositivoId);

    } catch (err) {

        console.error("⚠️ [PAGOS] No se pudo actualizar ultimo_movimiento_en:", err.message);

    }

}

// Solo para pruebas internas del backend en P1 (ver README) — filtra
// SIEMPRE por el usuario_id resuelto de la credencial autenticada, jamás
// por un valor del body/query, para que un dispositivo nunca pueda leer
// movimientos de otro tenant.
async function listarMovimientos(req, res) {

    try {

        const { usuarioId } = req.dispositivo;

        const { data, error } = await supabase
            .from("pagos_movimientos")
            .select("*")
            .eq("usuario_id", usuarioId)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {

            console.error("❌ [PAGOS] Error listando movimientos:", error.message);

            return res.status(500).json({
                success: false,
                error: "Error obteniendo movimientos"
            });

        }

        return res.json({
            success: true,
            movimientos: data
        });

    } catch (err) {

        console.error("❌ [PAGOS] Error inesperado en listarMovimientos:", err);

        return res.status(500).json({
            success: false,
            error: err.message
        });

    }

}

module.exports = {
    crearMovimiento,
    listarMovimientos
};
