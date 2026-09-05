// Espejo del lado cliente de backend/bot/ai/gramatica.js (formatearListaNumeros),
// usado SOLO para construir los datos de EJEMPLO de tiposMensaje.ts y así
// no transcribir a mano el formato "( 27 - 45 )" en cada ejemplo (mismo
// patrón que aplicarPlantillaPreview.ts ya usa para aplicarPlantilla).
// La sustitución real en producción la hace siempre el backend.
//
// FORMATO ÚNICO Y OBLIGATORIO: "( 27 )" para uno solo, "( 27 - 45 )" para
// varios. Nunca coma, nunca "/", nunca corchetes.
export function formatearListaNumeros(numeros: string[]): string {

    if (!numeros || numeros.length === 0) return "";

    return `( ${numeros.join(" - ")} )`;

}
