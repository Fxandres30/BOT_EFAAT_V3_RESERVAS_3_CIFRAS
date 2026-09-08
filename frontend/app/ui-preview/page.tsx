"use client";

/**
 * Página SOLO de desarrollo visual. No usa Supabase, ni APIs, ni datos
 * reales, ni lógica de negocio. Sirve para revisar los componentes de
 * `components/ui` de forma aislada.
 */

import { useState } from "react";
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  MoreVertical,
  Copy,
  Users,
  MessageSquare,
  Calendar,
  Inbox,
  Zap,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionHeader,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";

import styles from "./page.module.css";

const TOKENS: Array<{ name: string; varName: string }> = [
  { name: "Background", varName: "--efaat-bg" },
  { name: "Surface", varName: "--efaat-surface" },
  { name: "Sidebar", varName: "--efaat-sidebar" },
  { name: "Primary", varName: "--efaat-primary" },
  { name: "Primary soft", varName: "--efaat-primary-soft" },
  { name: "Success", varName: "--efaat-success" },
  { name: "Warning", varName: "--efaat-warning" },
  { name: "Error", varName: "--efaat-error" },
  { name: "Text", varName: "--efaat-text" },
  { name: "Secondary", varName: "--efaat-text-secondary" },
  { name: "Border", varName: "--efaat-border" },
];

export default function UIPreviewPage() {
  const [tab, setTab] = useState("grupos");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>EFAAT · UI Preview</h1>
      <p className={styles.pageLead}>
        Catálogo interno de componentes visuales. No conectado a datos.
      </p>

      <p className={styles.note}>
        Ruta de desarrollo. No enlazada en la navegación ni pensada para
        producción.
      </p>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tokens de color</h2>
        <div className={styles.swatchGrid}>
          {TOKENS.map((token) => (
            <div key={token.varName} className={styles.swatch}>
              <div
                className={styles.swatchColor}
                style={{ background: `var(${token.varName})` }}
              />
              <div className={styles.swatchLabel}>
                <b>{token.name}</b>
                {token.varName}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>PageHeader</h2>
        <PageHeader
          title="Sesiones"
          description="Administra las sesiones de WhatsApp del bot."
          actions={
            <Button leftIcon={<Plus size={15} />}>Agregar sesión</Button>
          }
        />
        <SectionHeader
          title="Grupos disponibles"
          description="Grupos reales de tus sesiones conectadas."
          actions={
            <Button variant="secondary" size="sm">
              Agregar por JID
            </Button>
          }
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Button</h2>
        <div className={styles.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <br />
        <div className={styles.row}>
          <Button size="sm" leftIcon={<Plus size={14} />}>
            Nuevo
          </Button>
          <Button size="sm" variant="secondary" rightIcon={<Search size={14} />}>
            Buscar
          </Button>
          <Button loading>Guardando</Button>
          <Button disabled>Deshabilitado</Button>
          <Button fullWidth variant="secondary">
            Full width
          </Button>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>IconButton</h2>
        <div className={styles.row}>
          <IconButton label="Editar">
            <Pencil size={16} />
          </IconButton>
          <IconButton label="Duplicar" variant="solid">
            <Copy size={16} />
          </IconButton>
          <IconButton label="Más opciones" variant="ghost">
            <MoreVertical size={16} />
          </IconButton>
          <IconButton label="Eliminar" variant="danger">
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Editar" size="sm">
            <Pencil size={14} />
          </IconButton>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Badge / StatusBadge</h2>
        <div className={styles.row}>
          <Badge>Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="error">Error</Badge>
        </div>
        <br />
        <div className={styles.row}>
          <StatusBadge status="online" label="Conectado" />
          <StatusBadge status="offline" label="Desconectado" />
          <StatusBadge status="pending" label="Esperando QR" />
          <StatusBadge status="active" label="Autorizado" />
          <StatusBadge status="inactive" label="Inactivo" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>StatCard</h2>
        <div className={styles.grid}>
          <StatCard label="Grupos" value="12" hint="de 18 registrados" icon={<Users size={16} />} />
          <StatCard label="Mensajes activos" value="34" tone="primary" icon={<MessageSquare size={16} />} />
          <StatCard label="Eventos activos" value="3/12" tone="success" icon={<Calendar size={16} />} />
          <StatCard label="Scheduler" value="Preparado" hint="sin arrancar" tone="warning" icon={<Zap size={16} />} />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Card</h2>
        <div className={styles.grid}>
          <Card>
            <strong>Card estándar</strong>
            <p style={{ margin: "6px 0 0", color: "var(--efaat-text-secondary)", fontSize: 13 }}>
              Padding md, sombra sutil.
            </p>
          </Card>
          <Card interactive padding="sm">
            <strong>Card interactiva</strong>
            <p style={{ margin: "6px 0 0", color: "var(--efaat-text-secondary)", fontSize: 13 }}>
              Hover con borde y sombra.
            </p>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Formularios</h2>
        <div className={styles.stack}>
          <Input
            label="Nombre de la sesión"
            placeholder="Ej. Ventas Bogotá"
            hint="Solo visible en el panel."
          />
          <Input
            label="Buscar"
            placeholder="Buscar grupo…"
            leftIcon={<Search size={15} />}
          />
          <Input
            label="JID del grupo"
            defaultValue="12036304@g.us"
            error="Formato de JID no válido."
          />
          <Select label="Tipo" defaultValue="reminder">
            <option value="open">Apertura</option>
            <option value="reminder">Recordatorio</option>
            <option value="update">Actualización</option>
            <option value="close">Cierre</option>
          </Select>
          <Textarea
            label="Plantilla"
            placeholder="Escribe el mensaje…"
            hint="Variables disponibles: {evento}, {valor}, {hora}"
            optional
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tabs</h2>
        <Tabs
          aria-label="Secciones de automatización"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "resumen", label: "Resumen" },
            { value: "grupos", label: "Grupos", icon: <Users size={14} /> },
            { value: "mensajes", label: "Mensajes", icon: <MessageSquare size={14} /> },
            { value: "programacion", label: "Programación", disabled: true },
          ]}
        />
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--efaat-text-secondary)" }}>
          Seleccionado: <b>{tab}</b>
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Modal</h2>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          Abrir modal
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Renombrar sesión"
          description="El nombre solo se usa en el panel."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setModalOpen(false)}>Guardar</Button>
            </>
          }
        >
          <Input label="Nuevo nombre" defaultValue="Ventas Bogotá" />
        </Modal>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>EmptyState</h2>
        <EmptyState
          icon={<Inbox size={20} />}
          title="Todavía no hay mensajes"
          description="Crea tu primera plantilla para que EFAAT empiece a responder."
          action={<Button leftIcon={<Plus size={15} />}>Nuevo mensaje</Button>}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Skeleton</h2>
        <Card>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Skeleton width={40} height={40} circle />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton text width="60%" />
              <Skeleton text width="40%" />
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={12} />
            <Skeleton height={12} width="80%" />
          </div>
        </Card>
      </section>
    </div>
  );
}
