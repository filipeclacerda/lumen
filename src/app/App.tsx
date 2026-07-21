import { useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, HardDrive, Menu, Moon, Sun } from "lucide-react";
import { Dashboard } from "../features/dashboard/Dashboard";
import { Transactions } from "../features/transactions/Transactions";
import { ImportPage } from "../features/import/ImportPage";
import { CategoriesRules } from "../features/categories/CategoriesRules";
import { Onboarding } from "../features/onboarding/Onboarding";
import { SettingsPage } from "../features/settings/SettingsPage";
import { AccountsCards } from "../features/accounts/AccountsCards";
import { Reports } from "../features/reports/Reports";
import { RecurringTransactions } from "../features/recurring/RecurringTransactions";
import { BudgetPage } from "../features/budget/BudgetPage";
import { api } from "../shared/api";
import { UpdateNotice } from "../shared/ui/UpdateNotice";
import { APP_VERSION } from "../shared/version";
import { CommandPalette } from "../shared/ui/CommandPalette";
import { navigationGroups, settingsNavigation } from "../shared/navigation";
import { useUiPreferences, type ThemePreference } from "../shared/uiPreferences";
import { ErrorState, LoadingState } from "../shared/ui/AsyncState";
import { BrandLogo } from "../shared/ui/BrandLogo";
import { useMaintenanceRestart } from "../shared/maintenanceRestart";
import { MaintenanceRestartNotice } from "../shared/ui/MaintenanceRestartNotice";
import { BackupReminderNotice } from "../shared/ui/BackupReminderNotice";
import { QuickStartGuide } from "../shared/ui/QuickStartGuide";

export function App() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const SettingsIcon = settingsNavigation.icon;
  const maintenanceRestartRequired = useMaintenanceRestart((state) => state.reason !== null);
  const theme = useUiPreferences((state) => state.resolvedTheme);
  const setThemePreference = useUiPreferences((state) => state.setThemePreference);
  const toggleTheme = () => {
    const next: ThemePreference = theme === "dark" ? "light" : "dark";
    setThemePreference(next);
  };
  const collapsed = useUiPreferences((state) => state.sidebar === "compact");
  const toggleSidebar = useUiPreferences((state) => state.toggleSidebar);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobileNavigation, setIsMobileNavigation] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const drawerPreviousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const updateNavigationMode = () => {
      setIsMobileNavigation(media.matches);
      if (!media.matches) setDrawerOpen(false);
    };
    updateNavigationMode();
    media.addEventListener("change", updateNavigationMode);
    return () => media.removeEventListener("change", updateNavigationMode);
  }, []);
  useEffect(() => {
    const isModalDrawer = isMobileNavigation && drawerOpen;
    const drawerElement = drawer.current;
    if (drawerElement) drawerElement.inert = isMobileNavigation && !drawerOpen;
    if (!isModalDrawer) return;
    drawerPreviousFocus.current = document.activeElement as HTMLElement | null;
    const main = document.querySelector<HTMLElement>("main");
    const trigger = drawerTrigger.current;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    if (trigger) trigger.inert = true;
    document.body.style.overflow = "hidden";
    const first = drawer.current?.querySelector<HTMLElement>("a[href],button:not([disabled])");
    first?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...(drawer.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!nodes.length) return;
      const firstNode = nodes[0],
        lastNode = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      if (main) main.inert = false;
      if (trigger) trigger.inert = false;
      document.body.style.overflow = previousOverflow;
      if (drawerPreviousFocus.current?.isConnected) drawerPreviousFocus.current.focus();
    };
  }, [drawerOpen, isMobileNavigation]);
  const {
    data: bootstrap,
    isLoading,
    isError,
    refetch,
  } = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap });
  useEffect(() => {
    if (!bootstrap?.onboardingCompleted) return;
    api.syncRecurringTransactions().then(async (count) => {
      if (count > 0) {
        await Promise.all([
          client.invalidateQueries({ queryKey: ["transactions"] }),
          client.invalidateQueries({ queryKey: ["summary"] }),
          client.invalidateQueries({ queryKey: ["financial-report"] }),
        ]);
      }
    });
    // Runs once per app session, right after the profile/account are known to exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap?.onboardingCompleted]);
  if (isLoading) return <LoadingState variant="page" label="Preparando seu espaço financeiro…" />;
  if (isError)
    return (
      <ErrorState
        variant="page"
        message="Não foi possível preparar seu espaço financeiro."
        onRetry={() => void refetch()}
      />
    );
  if (!bootstrap) return <ErrorState variant="page" onRetry={() => void refetch()} />;
  if (!bootstrap.onboardingCompleted)
    return (
      <Onboarding
        bootstrap={bootstrap}
        onFinished={async (destination) => {
          await Promise.all([
            client.invalidateQueries({ queryKey: ["bootstrap"] }),
            client.invalidateQueries({ queryKey: ["profile"] }),
            client.invalidateQueries({ queryKey: ["accounts"] }),
          ]);
          navigate(destination);
        }}
      />
    );
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${drawerOpen ? "drawer-open" : ""}`}>
      <button
        ref={drawerTrigger}
        className="mobile-menu-trigger"
        aria-label="Abrir menu"
        aria-expanded={drawerOpen}
        aria-controls="main-navigation"
        onClick={() => setDrawerOpen(true)}
      >
        <Menu size={20} />
      </button>
      {drawerOpen && (
        <button className="drawer-backdrop" aria-label="Fechar menu" onClick={() => setDrawerOpen(false)} />
      )}
      <aside ref={drawer} id="main-navigation">
        <div className="brand">
          <BrandLogo size={32} decorative />
          <div className="brand-copy">Lumen</div>
          <button
            className="sidebar-collapse"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        <nav className="sidebar-navigation" aria-label="Navegação principal">
          {navigationGroups.map((group, groupIndex) => {
            const headingId = `sidebar-group-${groupIndex}`;
            return (
              <section className="sidebar-nav-group" aria-labelledby={headingId} key={group.label}>
                <h2 id={headingId}>{group.label}</h2>
                <div>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === "/"}
                      title={label}
                      aria-label={collapsed && !isMobileNavigation ? label : undefined}
                      onClick={() => setDrawerOpen(false)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              </section>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <NavLink
            className="sidebar-settings"
            to={settingsNavigation.to}
            title={settingsNavigation.label}
            aria-label={collapsed && !isMobileNavigation ? settingsNavigation.label : undefined}
            onClick={() => setDrawerOpen(false)}
          >
            <SettingsIcon size={18} aria-hidden="true" />
            <span>{settingsNavigation.label}</span>
          </NavLink>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span>
          </button>
          <div className="sidebar-local-data">
            <HardDrive size={15} aria-hidden="true" />
            <span>Dados salvos localmente</span>
          </div>
          <div className="app-version">Lumen v{APP_VERSION}</div>
        </div>
      </aside>
      <main>
        <UpdateNotice enabled={bootstrap.onboardingCompleted} />
        <BackupReminderNotice enabled={bootstrap.onboardingCompleted} />
        {!maintenanceRestartRequired && <CommandPalette />}
        <div className="route-view" key={location.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/recurring" element={<RecurringTransactions />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/accounts" element={<AccountsCards />} />
            <Route path="/categories" element={<CategoriesRules />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Empty />} />
          </Routes>
        </div>
      </main>
      <QuickStartGuide />
      <MaintenanceRestartNotice />
    </div>
  );
}
function Empty() {
  return (
    <section>
      <h1>Em construção</h1>
      <p className="muted">A fundação desta área já está preparada para a próxima fase.</p>
    </section>
  );
}
