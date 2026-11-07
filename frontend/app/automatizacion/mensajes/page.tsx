import { redirect } from "next/navigation";

// Los mensajes de automatización se administran solo en la biblioteca
// central. Esta ruta se conserva para no romper enlaces guardados.
export default function Page() {
  redirect("/mensajes?vista=automatizacion");
}
