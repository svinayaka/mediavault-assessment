import { Component, type ReactNode, type ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  readonly resetKey?: string | number | null;
  readonly onReset?: () => void;
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  readonly onCatch?: (error: Error, errorInfo: ErrorInfo) => void;
  readonly children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onCatch?.(error, errorInfo);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return (
        <div className="panel-error-fallback" role="alert">
          <p className="error">Something went wrong in this panel.</p>
          <p className="muted">Try reloading, or switch to a different view.</p>
          {import.meta.env.DEV && <p className="muted">Dev note: {error.message}</p>}
          <button type="button" className="btn btn--retry" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
