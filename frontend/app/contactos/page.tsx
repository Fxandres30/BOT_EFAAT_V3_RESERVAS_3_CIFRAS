import DashboardLayout from "@/components/layout/DashboardLayout/DashboardLayout";
import ContactosPage from "@/components/contactos/ContactosPage/ContactosPage";

export default function Page() {
  return (
    <DashboardLayout>
      <ContactosPage />
    </DashboardLayout>
  );
}
