import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Database, Info, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";

export type SettingsSection = "general" | "appearance" | "data" | "privacy" | "about" | "danger";

export type SettingsNavigationItem = {
  id: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const settingsSections: readonly SettingsNavigationItem[] = [
  { id: "general", label: "Geral", description: "Perfil e resumo", icon: SlidersHorizontal },
  { id: "appearance", label: "Aparência", description: "Tema e visual", icon: Palette },
  { id: "data", label: "Dados e backup", description: "Exportar e recuperar", icon: Database },
  { id: "privacy", label: "Privacidade", description: "Processamento local", icon: ShieldCheck },
  { id: "about", label: "Sobre o Lumen", description: "Versão e atalhos", icon: Info },
  { id: "danger", label: "Zona de risco", description: "Apagar dados", icon: AlertTriangle },
];

const validSectionIds = new Set<SettingsSection>(settingsSections.map(({ id }) => id));

export function parseSettingsSection(value: string | null): SettingsSection {
  return value && validSectionIds.has(value as SettingsSection) ? (value as SettingsSection) : "general";
}
