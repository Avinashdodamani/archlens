import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time errors in the page tree so a single page crash shows a
 * readable message instead of a blank white screen, and logs the stack.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8">
          <div className="card max-w-2xl mx-auto border-danger/40">
            <h2 className="text-lg font-semibold text-danger mb-2">Something went wrong on this page</h2>
            <p className="text-sm text-dark-500 mb-4">
              An error occurred while rendering. The details below help pinpoint the cause.
            </p>
            <pre className="text-xs bg-dark-50 border border-dark-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap text-danger">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.error?.stack}
            </pre>
            <button onClick={this.handleReset} className="btn-primary mt-4">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
