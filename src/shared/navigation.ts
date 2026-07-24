import {
  BarChart3,
  CreditCard,
  FileUp,
  LayoutDashboard,
  ListChecks,
  Repeat,
  Settings,
  Tags,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = Readonly<{ to: string; label: string; icon: LucideIcon }>;
export type NavigationGroup = Readonly<{ label: string; items: ReadonlyArray<NavigationItem> }>;

const items = {
  overview: { to: "/", label: "Visão geral", icon: LayoutDashboard },
  reports: { to: "/reports", label: "Relatórios", icon: BarChart3 },
  transactions: { to: "/transactions", label: "Transações", icon: CreditCard },
  review: { to: "/review", label: "Pendências", icon: ListChecks },
  accounts: { to: "/accounts", label: "Contas e cartões", icon: WalletCards },
  recurring: { to: "/recurring", label: "Recorrências", icon: Repeat },
  import: { to: "/import", label: "Importar", icon: FileUp },
  budget: { to: "/budget", label: "Orçamento", icon: Wallet },
  categories: { to: "/categories", label: "Categorias e regras", icon: Tags },
  settings: { to: "/settings", label: "Configurações", icon: Settings },
} satisfies Record<string, NavigationItem>;

export const navigationGroups: ReadonlyArray<NavigationGroup> = [
  { label: "Acompanhar", items: [items.overview, items.reports] },
  { label: "Gerenciar", items: [items.transactions, items.review, items.accounts, items.recurring, items.import] },
  { label: "Planejar", items: [items.budget, items.categories] },
];

export const settingsNavigation = items.settings;

export const navigation: ReadonlyArray<NavigationItem> = [
  ...navigationGroups.flatMap((group) => group.items),
  settingsNavigation,
];
