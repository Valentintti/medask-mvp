import { Component, type ErrorInfo, type ReactNode } from 'react'
import { SafeErrorPage } from '../pages/SafeErrorPage'

interface ErrorBoundaryProps {
  children: ReactNode
  onError?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // 不向控制台或错误页输出原始输入、堆栈和内部路径。
    this.props.onError?.()
  }

  render() {
    if (this.state.hasError) return <SafeErrorPage />
    return this.props.children
  }
}
