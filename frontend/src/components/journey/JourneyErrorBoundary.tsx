import React, { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class JourneyErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[3D Journey Error caught by boundary]:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <section className="relative flex min-h-[85vh] w-full flex-col items-center justify-center overflow-hidden bg-slate-950 px-6 py-24 text-center text-white select-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(6,182,212,0.15),transparent_70%)]" />
          <div className="relative z-10 max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
              <AlertTriangle className="size-3.5 text-amber-400" />
              Standard View Mode Active
            </div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white">
              AUTONOMOUS LOGISTICS INTELLIGENCE
            </h1>
            <p className="max-w-2xl mx-auto text-base sm:text-lg font-medium text-slate-300 leading-relaxed">
              Real-time enterprise warehouse execution from security gate arrival and dock manifest inspection
              to automated putaway, robotics assembly, and exit clearance.
            </p>
            <div className="pt-4 flex flex-wrap justify-center gap-4">
              <Button
                onClick={this.handleRetry}
                variant="outline"
                className="rounded-xl border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 text-xs font-bold uppercase tracking-wider h-11 px-6"
              >
                <RefreshCw className="size-3.5 mr-2" />
                Retry 3D Twin
              </Button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

