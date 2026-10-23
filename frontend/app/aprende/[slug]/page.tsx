import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import ArticuloAprende from "@/components/aprende/ArticuloAprende";
import { ARTICULOS } from "@/lib/aprende/articulos";

interface Props {
    params: Promise<{
        slug: string;
    }>;
}

// Contenido estático: una página por artículo.
export function generateStaticParams() {
    return ARTICULOS.map((a) => ({ slug: a.slug }));
}

export default async function Page({ params }: Props) {

    const { slug } = await params;

    return (

        <DashboardLayout>

            <ArticuloAprende slug={slug} />

        </DashboardLayout>

    );

}
