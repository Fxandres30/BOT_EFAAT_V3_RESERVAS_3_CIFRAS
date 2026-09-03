const supabase = require("../../../lib/supabase");

// READ-ONLY. Determina el estado real de UN número. Solo devuelve estados
// que realmente existen en la tabla: libre, reservado (por el usuario
// actual o por otro) y pagado (por el usuario actual o por otro). No
// inventa ningún estado adicional. No filtra por evento_id (ver nota en
// consultarMisNumeros.js).
async function consultarNumero({ evento, usuario, numero }) {

    if (!evento?.tabla || !usuario?.id || !numero) {
        return null;
    }

    const { data, error } = await supabase
        .from(evento.tabla)
        .select("numero, estado, usuario_global_id")
        .eq("numero", numero)
        .maybeSingle();

    if (error) {

        console.log("❌ Error consultando número:", error.message);

        return null;

    }

    if (!data || data.estado === "libre") {

        return { numero, estadoReal: "libre" };

    }

    const esDelUsuario = data.usuario_global_id === usuario.id;

    if (data.estado === "reservado") {

        return {
            numero,
            estadoReal: esDelUsuario ? "reservado_por_usuario" : "reservado_por_otro"
        };

    }

    if (data.estado === "pagado") {

        return {
            numero,
            estadoReal: esDelUsuario ? "pagado_por_usuario" : "pagado_por_otro"
        };

    }

    // Estado no contemplado: se reporta tal cual, sin inventar interpretación.
    return { numero, estadoReal: data.estado };

}

module.exports = {
    consultarNumero
};
