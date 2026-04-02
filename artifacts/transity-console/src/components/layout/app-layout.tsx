import { useState } from "react";
import { useLocation } from "wouter";
import { SidebarNav } from "./sidebar";
import { Menu, BusFront } from "lucide-react";
import { Link } from "wouter";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/operators": "Operators",
  "/operators/new": "Register Operator",
  "/terminals": "Terminal Health",
  "/bookings": "Bookings",
  "/analytics": "Analytics",
};

function getPageTitle(location: string): string {
  if (PAGE_TITLES[location]) return PAGE_TITLES[location];
  if (location.startsWith("/operators/")) return "Edit Operator";
  return "TransityConsole";
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 xl:w-64 flex-shrink-0 border-r border-sidebar-border">
        <SidebarNav />
      </aside>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 w-72 flex flex-col shadow-xl transition-transform duration-300 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <SidebarNav onClose={() => setSidebarOpen(false)} />
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-border bg-card flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-foreground/60 hover:bg-muted transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center">
              <BusFront className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-display font-bold text-sm">
              Transity<span className="text-accent">Console</span>
            </span>
          </div>
          <div className="ml-auto">
            <span className="text-xs text-muted-foreground font-medium">{getPageTitle(location)}</span>
          </div>
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-4 py-5 sm:px-6 md:px-8 md:py-7 max-w-[1200px] mx-auto w-full anim-fade">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
