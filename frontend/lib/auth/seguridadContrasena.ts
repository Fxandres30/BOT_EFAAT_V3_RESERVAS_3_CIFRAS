// Evaluación orientativa de la seguridad de una contraseña, 100 % en el
// navegador: la contraseña nunca se envía a ningún servidor para analizarla.
// No pretende garantizar nada; solo detecta lo fácil de adivinar (contraseñas
// comunes, secuencias, repeticiones, años, datos personales) y premia la
// longitud real. Los símbolos por sí solos no hacen fuerte una contraseña.
//
// Sin imports a propósito: tests/auth la carga transpilándola directamente.

export type NivelSeguridad = 0 | 1 | 2 | 3;

export interface EvaluacionContrasena {
  nivel: NivelSeguridad;
  etiqueta: "Muy débil" | "Débil" | "Aceptable" | "Fuerte";
  sugerencias: string[];
  // Requisito mínimo para crear la cuenta.
  cumpleMinimo: boolean;
}

export const LONGITUD_MINIMA = 8;

const ETIQUETAS = ["Muy débil", "Débil", "Aceptable", "Fuerte"] as const;

// Contraseñas y palabras muy usadas (ya en minúsculas y sin sustituciones).
const COMUNES = [
  "password", "passw0rd", "contraseña", "contrasena", "clave", "secreto",
  "qwerty", "qwertyuiop", "asdfgh", "zxcvbn", "admin", "administrador",
  "letmein", "welcome", "bienvenido", "iloveyou", "teamo", "tequiero",
  "amor", "amorcito", "princesa", "princess", "dragon", "monkey", "master",
  "sunshine", "shadow", "football", "futbol", "baseball", "superman",
  "batman", "pokemon", "starwars", "hello", "hola", "holamundo", "usuario",
  "user", "login", "root", "test", "prueba", "default", "changeme",
  "mariposa", "estrella", "familia", "barcelona", "realmadrid", "america",
  "colombia", "mexico", "argentina", "espana", "efaat", "sorteo", "sorteos",
  "whatsapp", "google", "facebook", "instagram", "abc", "abcd", "qazwsx",
  "michael", "jessica", "daniel", "maria", "jesus", "dios", "angel",
  "chocolate", "corazon", "nicole", "andrea", "carlos",
  "fernando", "alejandro", "sebastian", "valentina", "camila", "samsung",
  "iphone", "computadora", "internet", "secret", "trustno1", "access",
  "freedom", "whatever", "charlie", "killer", "soccer", "cookie"
];

const FILAS_TECLADO = ["qwertyuiop", "asdfghjklñ", "zxcvbnm", "1234567890"];

const DESHACER_SUSTITUCIONES: Record<string, string> = {
  "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t"
};

function sinSustituciones(texto: string) {
  return texto.replace(/[@431!0$57]/g, (c) => DESHACER_SUSTITUCIONES[c]);
}

function quitarAdornos(texto: string) {
  // "Password2024!" → "password": dígitos y símbolos al principio o al final.
  return texto.replace(/^[^a-zñ]+|[^a-zñ]+$/g, "");
}

// Marca como "previsibles" todos los caracteres de un tramo salvo el primero:
// un tramo previsible aporta lo mismo que un solo carácter.
function marcar(mascara: boolean[], desde: number, largo: number) {
  for (let i = desde + 1; i < desde + largo; i++) mascara[i] = true;
}

function marcarSubcadena(mascara: boolean[], texto: string, sub: string) {
  let pos = texto.indexOf(sub);
  let hubo = false;
  while (pos !== -1) {
    marcar(mascara, pos, sub.length);
    hubo = true;
    pos = texto.indexOf(sub, pos + sub.length);
  }
  return hubo;
}

export function evaluarContrasena(password: string, datosPersonales: string[] = []): EvaluacionContrasena {
  const largo = password.length;
  const minus = password.toLowerCase();
  const normal = sinSustituciones(minus);
  const mascara: boolean[] = new Array(largo).fill(false);

  let haySecuencia = false;
  let hayRepeticion = false;
  let hayAnio = false;
  let hayComun = false;
  let hayPersonal = false;

  // Secuencias ascendentes o descendentes (abcdef, 654321) de 3 o más.
  for (let i = 0; i < largo - 2; ) {
    const paso = minus.charCodeAt(i + 1) - minus.charCodeAt(i);
    if (paso !== 1 && paso !== -1) { i++; continue; }
    let j = i + 1;
    while (j + 1 < largo && minus.charCodeAt(j + 1) - minus.charCodeAt(j) === paso) j++;
    if (j - i + 1 >= 3) { marcar(mascara, i, j - i + 1); haySecuencia = true; }
    i = j;
  }

  // Filas del teclado (qwerty, asdf) en cualquier sentido, desde 4 teclas.
  for (const fila of FILAS_TECLADO) {
    for (const f of [fila, [...fila].reverse().join("")]) {
      for (let n = f.length; n >= 4; n--) {
        for (let k = 0; k + n <= f.length; k++) {
          if (marcarSubcadena(mascara, minus, f.slice(k, k + n))) haySecuencia = true;
        }
      }
    }
  }

  // Mismo carácter repetido 3 o más veces (aaaa, 1111).
  for (const m of minus.matchAll(/(.)\1{2,}/g)) {
    marcar(mascara, m.index ?? 0, m[0].length);
    hayRepeticion = true;
  }

  // Bloques repetidos (abcabc, holahola): la copia no aporta nada.
  for (const m of minus.matchAll(/(.{2,}?)\1+/g)) {
    const inicio = (m.index ?? 0) + m[1].length;
    for (let i = inicio; i < (m.index ?? 0) + m[0].length; i++) mascara[i] = true;
    hayRepeticion = true;
  }

  // Años (1950–2039): fáciles de adivinar.
  for (const m of minus.matchAll(/(19[5-9]\d|20[0-3]\d)/g)) {
    marcar(mascara, m.index ?? 0, 4);
    hayAnio = true;
  }

  // Palabras comunes dentro de la contraseña (también con sustituciones: p@ssw0rd).
  for (const palabra of COMUNES) {
    if (palabra.length >= 4 && normal.includes(palabra)) {
      marcarSubcadena(mascara, normal, palabra);
      hayComun = true;
    }
  }

  // Nombre o correo de la persona.
  const tokens = datosPersonales
    .flatMap((d) => d.toLowerCase().split(/[\s@._+-]+/))
    .filter((t) => t.length >= 3);
  for (const t of tokens) {
    if (minus.includes(t)) { marcarSubcadena(mascara, minus, t); hayPersonal = true; }
  }

  const efectiva = mascara.filter((m) => !m).length;
  const base = quitarAdornos(normal);
  const esComun = COMUNES.includes(minus) || (base.length > 0 && COMUNES.includes(base));

  const clases = [/[a-zñ]/, /[A-ZÑ]/, /\d/, /[^a-zA-ZñÑ\d]/].filter((r) => r.test(password)).length;

  let nivel: number;
  if (largo < LONGITUD_MINIMA || esComun || efectiva < 6) nivel = 0;
  else {
    nivel = efectiva >= 16 ? 3 : efectiva >= 12 ? 2 : efectiva >= 8 ? 1 : 0;
    // La variedad solo suma cuando ya hay longitud real detrás.
    if (clases >= 3 && efectiva >= 8) nivel += 1;
    if (/^\d+$/.test(password)) nivel = Math.min(nivel, 1);
    nivel = Math.min(nivel, 3);
  }

  const sugerencias: string[] = [];
  if (largo < LONGITUD_MINIMA) sugerencias.push(`Añade más caracteres (mínimo ${LONGITUD_MINIMA}).`);
  if (esComun) sugerencias.push("Es una contraseña muy común; elige otra.");
  if (haySecuencia) sugerencias.push("Evita secuencias fáciles de adivinar (123456, abcdef, qwerty).");
  if (hayRepeticion) sugerencias.push("Evita repetir caracteres o bloques (aaaa, abcabc).");
  if (hayAnio) sugerencias.push("Evita años o fechas.");
  if (hayPersonal) sugerencias.push("No uses tu nombre ni tu correo.");
  if (hayComun && !esComun) sugerencias.push("Evita palabras muy usadas como «password» o «amor».");
  if (nivel < 3 && largo >= LONGITUD_MINIMA && efectiva < 16) sugerencias.push("Añade más caracteres.");
  if (nivel < 3) sugerencias.push("Combina palabras o utiliza una frase larga y única.");
  if (nivel === 3) sugerencias.push("Buena contraseña.");

  return {
    nivel: nivel as NivelSeguridad,
    etiqueta: ETIQUETAS[nivel],
    sugerencias: sugerencias.slice(0, 3),
    cumpleMinimo: largo >= LONGITUD_MINIMA && nivel >= 1
  };
}
