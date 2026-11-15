# Latencia de los botones de la barra de Tablas

Fecha: 14/11/2026. Fases 1, 2 y 3 (opción B) aprobadas y en el commit; **sin desplegar**.

## Qué se cambió

| Fase | Cambio | Archivos |
|---|---|---|
| 1 | Antes de capturar la imagen se cede un fotograma: el spinner o la ventana se pintan primero. | `frontend/components/tablas/capturaTabla.tsx` |
| 1 | El CSS de fuentes de la imagen se calcula una vez (`getFontEmbedCSS`, la misma función que usa `toPng`) en lugar de descargar 11 fuentes en cada captura. Imagen idéntica. | `frontend/services/tablas/capturarTabla.ts` |
| 1 | La revisión de «Reiniciar» lee números y sorteos activos a la vez. | `frontend/services/tablas/fuenteRifa.ts` |
| 1 | El resultado del reinicio se muestra cuando confirma el servidor; la recarga sigue detrás con la tabla bloqueada (clave `*`). «Actualizar» y el reinicio recargan tabla e historial a la vez. | `frontend/hooks/useTablaPrecio.ts` |
| 2 | «Editar» pide el detalle solo de borradores y programados (los únicos editables), adelanta los catálogos del formulario (lecturas de un solo uso, 10 s, anuladas por cualquier escritura) y el formulario reutiliza el sorteo ya leído: 22 → 10 peticiones. | `AnuncioSorteoModal.tsx`, `FormularioSorteo.tsx`, `apiSorteos.ts`, `apiRifas.ts` |
| 3 | La imagen se prepara por adelantado en ratos de inactividad y solo se usa si su clave (números + diseño + ancho) es la de la tabla en pantalla al compartir; si no, se genera en ese momento. | `frontend/services/tablas/precapturaTabla.ts`, `frontend/components/tablas/usePrecapturaTabla.ts`, `TablaPrecioView.tsx` |

Sin cambios en el generador de imágenes, en `pixelRatio` (2), en la lógica de negocio ni en las validaciones.

## Garantías de la imagen (verificadas)

- Una imagen preparada solo se entrega si su clave coincide con la tabla actual; cualquier reserva, pago, liberación, bloqueo, diseño o ancho distinto la invalida (`frontend/tests/tablas/precapturaTabla.test.mjs`, incluida la carrera «se prepara A, cambia a B, se comparte B»).
- Medido en entorno aislado: la imagen preparada es idéntica byte a byte a una generada en el momento para el mismo estado, y las huellas son las mismas que con el código anterior (misma resolución y apariencia).
- Un fallo de generación nunca queda guardado.

## Resultados medidos (ms, escritorio / móvil CPU×4)

| Botón | Clic → pintado antes | después | Operación completa antes | después |
|---|---|---|---|---|
| Compartir (imagen preparada) | 376 / 2.776 | 48 / 88 | 679 / 3.254 | 304 / 352 |
| Cambiar grupos | 512 / 3.376 | 32 / 88 | 562 / 3.538 | 302 / 329 |
| Editar | 24 / 56 | 40 / 88 | 1.138 / 1.287 | 871 / 971 |
| Reiniciar (revisar) | 16 / 48 | 24 / 56 | 357 / 410 | 184 / 264 |
| Reiniciar (confirmar) | — | — | 637 / 1.017 | 471 / 575 |
| Actualizar | 16 / 72 | 24 / 64 | 191 / 457 | 190 / 269 |

Entorno: panel compilado (`next build`), Supabase y backend simulados con 150 / 250 ms de latencia, Chrome sin interfaz. Personalizar, Diseños y Editar valor no se modificaron (su coste en móvil es el desenfoque del `Modal` compartido).

## Limitación conocida (pendiente de una optimización posterior)

**Generar la imagen sigue siendo una tarea larga e indivisible del navegador**: dibujar el SVG con estilos en línea que crea html-to-image (`toCanvas`). Medido con trazas: ≈0,3–0,8 s en escritorio y ≈3–4 s en un móvil lento. No influyen las fuentes ni la codificación del PNG. La opción B solo decide **cuándo** ocurre:

- Escritorio: se prepara tras 2 s sin tocar la página; un clic que llegue justo durante esa tarea espera a que termine.
- Móvil lento (la última imagen tardó más de 1,5 s): la primera preparación ocurre con la pestaña visible; después solo se prepara con la pestaña oculta.
- Sin imagen preparada (justo después de un cambio, o en un móvil lento con la pestaña visible), «Compartir» muestra el spinner al instante pero la pantalla queda congelada mientras se genera (≈0,7–1 s en escritorio, ≈3,5–4,6 s en móvil lento).

Reducirlo exige cambiar el generador (p. ej. limitar los estilos que copia html-to-image o dibujar de otra forma) o bajar `pixelRatio`; ninguna de las dos cosas está autorizada. Queda para un estudio posterior sin comprometer la calidad actual.
