import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout/app-layout";
import Dashboard from "@/pages/dashboard";
import OperatorsList from "@/pages/operators/index";
import OperatorNew from "@/pages/operators/new";
import OperatorDetail from "@/pages/operators/[id]";
import TerminalsList from "@/pages/terminals/index";
import BookingsList from "@/pages/bookings/index";
import AnalyticsDashboard from "@/pages/analytics/index";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/operators" component={OperatorsList} />
        <Route path="/operators/new" component={OperatorNew} />
        <Route path="/operators/:id" component={OperatorDetail} />
        <Route path="/terminals" component={TerminalsList} />
        <Route path="/bookings" component={BookingsList} />
        <Route path="/analytics" component={AnalyticsDashboard} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="transity-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
