import { NavLink, Route, Routes } from "react-router-dom";
import { BarChart3, CreditCard, FileUp, LayoutDashboard, Settings, Tags, WalletCards } from "lucide-react";
import { Dashboard } from "../features/dashboard/Dashboard";
import { Transactions } from "../features/transactions/Transactions";
import { ImportPage } from "../features/import/ImportPage";
import { CategoriesRules } from "../features/categories/CategoriesRules";

const nav = [
  ["/", "Visão geral", LayoutDashboard],
  ["/transactions", "Transações", CreditCard],
  ["/import", "Importar", FileUp],
  ["/accounts", "Contas e cartões", WalletCards],
  ["/categories", "Categorias e regras", Tags],
  ["/reports", "Relatórios", BarChart3],
  ["/settings", "Configurações", Settings]
] as const;

export function App() {
  return <div className="shell">
    <aside>
      <div className="brand"><span>F</span><div>Finança<br/><small>seu dinheiro, claro</small></div></div>
      <nav>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"}><Icon size={18}/>{label}</NavLink>)}</nav>
      <div className="privacy">🔒 Seus dados ficam neste computador</div>
    </aside>
    <main><Routes>
      <Route path="/" element={<Dashboard/>}/>
      <Route path="/transactions" element={<Transactions/>}/>
      <Route path="/import" element={<ImportPage/>}/>
      <Route path="/categories" element={<CategoriesRules/>}/>
      <Route path="*" element={<Empty/>}/>
    </Routes></main>
  </div>;
}
function Empty() { return <section><h1>Em construção</h1><p className="muted">A fundação desta área já está preparada para a próxima fase.</p></section> }
