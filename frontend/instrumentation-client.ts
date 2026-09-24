// Next.js ejecuta este archivo en el navegador en todas las páginas, antes
// de hidratar, sin pasar por ningún layout ni componente. Solo arranca el
// recolector de visitas (lib/analitica/tracker.ts), que no renderiza nada.
import { iniciar, navegacion } from "./lib/analitica/tracker";

iniciar();

export function onRouterTransitionStart(url: string) {
    navegacion(url);
}
