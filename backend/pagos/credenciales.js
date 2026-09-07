// ==========================================================================
// Credenciales de dispositivo — hash/verificación, SIN dependencias nuevas
// (usa `crypto` nativo de Node: scrypt + comparación en tiempo constante).
//
// El secreto en texto plano NUNCA se guarda. `pagos_dispositivos.credencial_hash`
// solo guarda "<salt_hex>:<hash_hex>". Ver backend/pagos/crearDispositivo.js
// para el único momento en que el secreto en texto plano existe (se muestra
// una vez al crear el dispositivo y no se puede recuperar después).
// ==========================================================================

const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;

// 32 bytes aleatorios en hex (64 caracteres) — el secreto que la app
// Android guarda de su lado y envía en cada request.
function generarSecreto() {

    return crypto.randomBytes(32).toString("hex");

}

// Produce "<salt_hex>:<hash_hex>" para guardar en credencial_hash.
function hashCredencial(secretoPlano) {

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(secretoPlano, salt, SCRYPT_KEYLEN).toString("hex");

    return `${salt}:${hash}`;

}

// Compara un secreto en texto plano contra el hash guardado, en tiempo
// constante (crypto.timingSafeEqual) para no filtrar por temporización
// cuánto del secreto coincide.
function verificarCredencial(secretoPlano, credencialHash) {

    if (!secretoPlano || !credencialHash || typeof credencialHash !== "string") {

        return false;

    }

    const separador = credencialHash.indexOf(":");

    if (separador <= 0) {

        return false;

    }

    const salt = credencialHash.slice(0, separador);
    const hashGuardadoHex = credencialHash.slice(separador + 1);

    if (!salt || !hashGuardadoHex) {

        return false;

    }

    let hashCalculado;

    try {

        hashCalculado = crypto.scryptSync(secretoPlano, salt, SCRYPT_KEYLEN);

    } catch (err) {

        return false;

    }

    const hashGuardado = Buffer.from(hashGuardadoHex, "hex");

    if (hashGuardado.length !== hashCalculado.length) {

        return false;

    }

    return crypto.timingSafeEqual(hashCalculado, hashGuardado);

}

module.exports = {
    generarSecreto,
    hashCredencial,
    verificarCredencial
};
