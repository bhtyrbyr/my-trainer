import { Component, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'
import { sendErrorReport } from '@/lib/errorReport'

type Props = WithTranslation & { children: ReactNode }
type State = { error: unknown; report: 'idle' | 'sending' | 'sent' | 'failed' }

/** Last line of defence for render-time crashes: a readable screen with a reload action instead of a blank page. */
class Boundary extends Component<Props, State> {
  state: State = { error: null, report: 'idle' }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  report = async () => {
    this.setState({ report: 'sending' })
    try {
      const stack = this.state.error instanceof Error ? this.state.error.stack?.slice(0, 1200) : undefined
      await sendErrorReport(this.state.error, { stack, note: 'render crash' })
      this.setState({ report: 'sent' })
    } catch {
      this.setState({ report: 'failed' })
    }
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled render error', error)
  }

  render() {
    const { t, children } = this.props
    if (!this.state.error) return children
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center pt-safe pb-safe">
        <p className="eyebrow">{t('common:appName')}</p>
        <h1 className="display text-[28px]">{t('common:errors.crashTitle')}</h1>
        <p className="text-sm text-ink-muted">{errorMessage(this.state.error, t)}</p>
        <Button className="gap-2" onClick={() => window.location.reload()}>
          <RefreshCw className="size-4" aria-hidden />
          {t('common:errors.reload')}
        </Button>
        {this.state.report === 'sent' ? (
          <p className="text-sm text-ink-muted">{t('common:errors.reportSent')}</p>
        ) : (
          <Button variant="ghost" className="gap-2" disabled={this.state.report === 'sending'} onClick={() => void this.report()}>
            <Send className="size-4" aria-hidden />
            {this.state.report === 'failed' ? t('common:errors.reportFailed') : t('common:errors.report')}
          </Button>
        )}
      </div>
    )
  }
}

export const ErrorBoundary = withTranslation('common')(Boundary)
