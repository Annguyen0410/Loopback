import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render errors from any page so one broken screen never blanks
 * the whole app (which would look like "the app randomly stopped working").
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] uncaught page error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="page">
          <h1>Something went wrong</h1>
          <div className="alert alert-error">
            <strong>{this.state.error.message || 'Unknown rendering error'}</strong>
          </div>
          <p className="muted">The rest of the app is unaffected — go back or reload.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
