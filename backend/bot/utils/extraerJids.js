function extraerJids(obj, encontrados = new Set()) {

    if (!obj) return [...encontrados];

    if (typeof obj === "string") {

        if (
            obj.endsWith("@lid") ||
            obj.endsWith("@s.whatsapp.net")
        ) {

            encontrados.add(obj);

        }

        return [...encontrados];

    }

    if (Array.isArray(obj)) {

        for (const item of obj) {

            extraerJids(item, encontrados);

        }

        return [...encontrados];

    }

    if (typeof obj === "object") {

        for (const value of Object.values(obj)) {

            extraerJids(value, encontrados);

        }

    }

    return [...encontrados];

}

module.exports = extraerJids;