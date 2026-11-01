# Reversión segura del backend — mensajes de publicación (20 diseños)

Preparado el 31/10/2026. Procedimiento para volver el backend (Droplet) a una versión **anterior** al sistema de 20 diseños sin publicar mensajes con variables sin procesar. Ningún paso se ejecuta sin autorización.

## Por qué hace falta un procedimiento

El backend nuevo guarda en cada sorteo (`sorteos_programados.config.mensajes`):

- el texto con `{{variables}}`, que puede usar **11 variables nuevas**: `nombre_mayusculas`, `fecha_larga`, `fecha_titulo`, `dia_semana`, `rango`, `premio_mayor`, `premios_linea`, `premios_numerados`, `premios_texto`, `premios_guias`, `cuentas_compacto`;
- `publicacion_meta`: estilo, **activo**, personalizado, revisión y fecha.

Un backend anterior:

| Situación | Qué haría el backend anterior |
|---|---|
| Texto con variables nuevas | Las envía **literales** a WhatsApp (solo avisa en la vista previa). |
| Mensaje **inactivo** | Ignora `activo`: lo publica **con** texto. |
| Diseños con marco (Boleto, Citas, Tarjetas) | El marco solo queda en la primera línea de cada lista: se ve peor, pero no falta ningún dato. |
| Sorteos antiguos o con texto clásico | Igual que siempre: sin riesgo. |
| Tabla `preferencias_mensaje_sorteo` (042) | No la usa: inocua. |

La reversión es segura **solo si** antes de cambiar el código no queda ningún sorteo de los dos primeros tipos.

## Procedimiento

### Paso 0 — Decidir si de verdad hay que revertir
Si el problema está en otra parte (Tablas, Realtime, otro módulo), revertir solo ese cambio es más seguro que volver todo el backend atrás.

### Paso 1 — Inventario (solo lectura, con el backend NUEVO todavía en marcha)
Ejecutar `docs/activacion/mensajes_incompatibles_reversion_solo_lectura.sql` en el SQL Editor. Lista cada sorteo con su riesgo, sin mostrar el texto.

- **0 filas** → ir al paso 3.
- **Hay filas** → paso 2.

### Paso 2 — Dejar cada sorteo compatible (con el backend nuevo, desde el panel)
Para cada fila, quien administra la cuenta decide; nada se hace automáticamente.

| Riesgo | Opción recomendada | Alternativa |
|---|---|---|
| Variables nuevas, sin publicar | Editar el sorteo → diseño **Clásico EFAAT** → «Restaurar diseño original» (o reescribir el texto solo con las 8 variables de siempre) → guardar. | Cancelar la programación. |
| Variables nuevas, **en curso** (`en_curso = true`) | Editar el sorteo activo con el mismo cambio: «Compartir» usaría ese texto. | No usar «Compartir» con ese sorteo hasta que termine. |
| Mensaje **inactivo**, sin publicar | El backend anterior no sabe publicar solo la imagen: **cancelar o posponer** la programación hasta volver al backend nuevo. | Aceptar que se publique con texto: reactivarlo y revisar el texto. |

Volver a ejecutar la consulta del paso 1 hasta que devuelva **0 filas**. Entre este paso y el 3 no deben crearse sorteos con diseños nuevos: avisar a los clientes, o hacer los pasos 2 a 4 en una ventana corta.

### Paso 3 — Revertir el backend
1. En el Droplet, anotar el commit actual (`git rev-parse HEAD`) para poder volver.
2. Cambiar al commit anterior autorizado y reiniciar el proceso de PM2 (con autorización aparte).
3. **No** eliminar la tabla 042 ni tocar `config.mensajes`: el backend anterior los ignora y así se puede volver al nuevo sin perder nada.

### Paso 4 — Panel
- **Recomendado:** volver también el panel (Vercel) a la versión anterior, para que nadie elija diseños que el backend ya no entiende.
- Si el panel nuevo se queda: no puede cargar el catálogo de diseños (el backend anterior responde 404) y muestra el campo de texto de siempre. Pero ese campo deja escribir a mano una variable nueva, y el backend anterior la aceptaría: hay que avisar a quienes administran.

### Paso 5 — Verificación
1. Ejecutar otra vez la consulta del paso 1: **0 filas**.
2. Abrir la vista previa de un sorteo programado: no debe aparecer «Variables desconocidas que se enviarán tal cual».
3. Probar «Compartir» y una publicación en un **grupo de prueba**.

### Volver al backend nuevo después
Basta con desplegarlo otra vez: los textos y metadatos siguen guardados. Los sorteos que se pasaron a Clásico en el paso 2 se quedan en Clásico hasta que alguien los cambie.

## Prevención para próximos despliegues
- Desplegar siempre el **backend antes que el panel**.
- Antes de habilitar los diseños a los clientes, dejar pasar un periodo de observación en el que revertir no requiera el paso 2 (por ejemplo, probándolos solo en una cuenta interna).
