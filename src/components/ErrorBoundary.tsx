import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n/config";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // No APM/error-tracking service is wired up yet (e.g. Sentry) — this is the
    // only record of render crashes until one is added with real credentials.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="flex max-w-sm flex-col items-center text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="mt-6 font-display text-2xl tracking-tight text-foreground">
              {i18n.t("errorBoundary.title", { ns: "common" })}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {i18n.t("errorBoundary.body", { ns: "common" })}
            </p>
            <Button className="mt-6 rounded-full" onClick={() => window.location.reload()}>
              {i18n.t("errorBoundary.reload", { ns: "common" })}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
