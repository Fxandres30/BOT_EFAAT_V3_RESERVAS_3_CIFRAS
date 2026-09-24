import PanelAnalitica from "./_componentes/PanelAnalitica";

// Área privada de analítica, no enlazada desde ningún sitio. El acceso lo
// decide el backend con la sesión de Supabase Auth del navegador (ver
// PanelAnalitica): sin sesión de administrador se muestra el 404 estándar.
export default function AnaliticaPrivadaPage() {
    return <PanelAnalitica />;
}
