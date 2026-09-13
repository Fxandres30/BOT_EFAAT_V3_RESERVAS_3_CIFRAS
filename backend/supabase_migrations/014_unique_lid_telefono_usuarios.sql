-- Cierra la brecha de concurrencia que el propio código ya anticipaba desde
-- hace tiempo: backend/bot/funciones/usuarios/obtenerUsuarioGlobal.js
-- (sección "Concurrencia", líneas ~379-401) reintenta el INSERT de un
-- usuario nuevo asumiendo que Postgres devolverá 23505 (unique_violation)
-- si dos mensajes casi simultáneos del mismo lid/teléfono nuevo llegan a la
-- vez -- pero ese índice UNIQUE nunca se creó. Hoy la única protección es la
-- ventana de tiempo entre el SELECT y el INSERT en JS (auditoría Identidad
-- Real, 2026-09-13).
--
-- Verificado ANTES de escribir esta migración contra el Supabase real del
-- proyecto (1000 usuarios, solo lectura): 0 lid duplicados, 0 teléfonos
-- duplicados -- el índice se puede crear sin fallar ni tener que fusionar
-- ningún dato ambiguo.
--
-- Parcial (WHERE ... IS NOT NULL) porque muchas filas tienen lid=NULL o
-- telefono=NULL (una persona identificada solo por uno de los dos) -- un
-- UNIQUE normal en Postgres ya trata múltiples NULL como no-conflictivos
-- entre sí, pero la cláusula WHERE lo deja explícito y evita indexar filas
-- irrelevantes.
--
-- No borra nada, no fusiona nada, no cambia ninguna fila existente.
-- Ejecutar manualmente en el SQL Editor de Supabase, igual que las
-- anteriores.

create unique index if not exists usuarios_lid_unico
    on public.usuarios (lid)
    where lid is not null;

create unique index if not exists usuarios_telefono_unico
    on public.usuarios (telefono)
    where telefono is not null;
