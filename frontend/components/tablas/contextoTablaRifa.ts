"use client";

import { createContext, useContext } from "react";

// tabla_id de la rifa abierta en la pantalla de Tablas (motor de rifas
// independientes) o null en la tabla de siempre (por precio). Los
// componentes que piden datos al servidor por su cuenta (ventana del número,
// selección) lo usan para pedir los de ESA rifa; el diseño no cambia.
export const TablaRifaContext = createContext<string | null>(null);

export const useTablaRifaId = () => useContext(TablaRifaContext);
