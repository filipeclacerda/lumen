import { Component, type ReactNode } from "react";
import { ErrorState } from "./AsyncState";

type Props = {
  children: ReactNode;
  message?: string;
  variant?: "page" | "panel";
  reload?: () => void;
};

type State = { failed: boolean };

export class LazyErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  private retry = () => {
    (this.props.reload ?? (() => window.location.reload()))();
  };

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          variant={this.props.variant ?? "panel"}
          message={this.props.message ?? "Não foi possível carregar este conteúdo."}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
