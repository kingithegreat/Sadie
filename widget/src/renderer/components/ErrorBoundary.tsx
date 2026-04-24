import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  zone?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[SADIE] Error Boundary${this.props.zone ? ` (${this.props.zone})` : ''} caught:`, error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.zone) {
      return (
        <div className="error-boundary-zone">
          <span className="error-boundary-label">{this.props.zone} crashed</span>
          <button onClick={this.handleDismiss} className="error-boundary-retry">Retry</button>
        </div>
      );
    }

    return (
      <div style={{
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        background: '#1a1a2e',
        textAlign: 'center',
      }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Something went wrong</h2>
        <p style={{ color: '#94a3b8', marginBottom: '1rem', maxWidth: '480px' }}>
          SADIE hit an unexpected error. You can try dismissing it or reloading.
        </p>
        <pre style={{
          background: '#0f0f23',
          padding: '1rem',
          borderRadius: '8px',
          maxWidth: '600px',
          overflow: 'auto',
          fontSize: '0.8rem',
          color: '#f87171',
          marginBottom: '1.5rem',
          maxHeight: '200px',
        }}>
          {this.state.error?.message || 'Unknown error'}
        </pre>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={this.handleDismiss}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid #334155',
              background: 'transparent',
              color: '#e2e8f0',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
          <button
            onClick={this.handleReload}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
