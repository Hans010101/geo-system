import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

// Pages
import Home from "./pages/Home";
import QuestionDetail from "./pages/QuestionDetail";
import CitationAnalysis from "./pages/CitationAnalysis";
import WeeklyReports from "./pages/WeeklyReports";
import AlertCenter from "./pages/AlertCenter";
import ConfigQuestions from "./pages/ConfigQuestions";
import ConfigTargetFacts from "./pages/ConfigTargetFacts";
import ConfigOurContent from "./pages/ConfigOurContent";
import ConfigPlatforms from "./pages/ConfigPlatforms";
import ConfigCollection from "./pages/ConfigCollection";
import ConfigScheduler from "./pages/ConfigScheduler";
import ConfigUsers from "./pages/ConfigUsers";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/questions" component={QuestionDetail} />
        <Route path="/questions/:questionId" component={QuestionDetail} />
        <Route path="/citations" component={CitationAnalysis} />
        <Route path="/reports" component={WeeklyReports} />
        <Route path="/alerts" component={AlertCenter} />
        <Route path="/config/questions" component={ConfigQuestions} />
        <Route path="/config/target-facts" component={ConfigTargetFacts} />
        <Route path="/config/our-content" component={ConfigOurContent} />
        <Route path="/config/platforms" component={ConfigPlatforms} />
        <Route path="/config/collection" component={ConfigCollection} />
        <Route path="/config/scheduler" component={ConfigScheduler} />
        <Route path="/config/users" component={ConfigUsers} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
