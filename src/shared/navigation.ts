import {
  BarChart3,
  CreditCard,
  FileUp,
  LayoutDashboard,
  Repeat,
  Settings,
  Tags,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
export const navigation: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/transactions", label: "Transações", icon: CreditCard },
  { to: "/recurring", label: "Recorrências", icon: Repeat },
  { to: "/budget", label: "Orçamento", icon: Wallet },
  { to: "/import", label: "Importar", icon: FileUp },
  { to: "/accounts", label: "Contas e cartões", icon: WalletCards },
  { to: "/categories", label: "Categorias e regras", icon: Tags },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/settings", label: "Configurações", icon: Settings },
];
