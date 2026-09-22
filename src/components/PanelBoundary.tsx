import { type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

export interface PanelBoundaryProps {
  readonly name: string;
  readonly error?: string | null;
  readonly resetKey?: string | number | null;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}

export interface PanelErrorFallbackProps {
  readonly name: string;
  readonly error?: string | null;
  readonly devNote?: string;
  readonly onRetry?: () => void;
}

export function PanelErrorFallback({
  name,
  error,
  devNote,
  onRetry,
}: Readonly<PanelErrorFallbackProps>) {
  return (
    <div className="panel-error-fallback" role="alert">
      <p className="error">
        <strong>{name} issue:</strong> {error ?? 'Something went wrong displaying this section.'}
      </p>
      {devNote && (
        <p className="muted">Try reloading this section to restore normal operation.</p>
      )}
      {import.meta.env.DEV && devNote && <p className="muted">Dev note: {devNote}</p>}
      {onRetry && (
        <button
          type="button"
          className="btn btn--retry"
          onClick={onRetry}
        >
          Reload {name.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function createPanelFallback(name: string, onRetry?: () => void) {
  return (err: Error, resetBoundary: () => void): ReactNode => (
    <PanelErrorFallback
      name={name}
      devNote={err.message}
      onRetry={onRetry ? resetBoundary : undefined}
    />
  );
}

export function PanelBoundary({
  name,
  error,
  resetKey,
  onRetry,
  children,
}: Readonly<PanelBoundaryProps>) {
  return (
    <ErrorBoundary
      resetKey={resetKey}
      onReset={onRetry}
      fallback={createPanelFallback(name, onRetry)}
    >
      {error ? (
        <PanelErrorFallback
          name={name}
          error={error}
          onRetry={onRetry}
        />
      ) : (
        children
      )}
    </ErrorBoundary>
  );
}
