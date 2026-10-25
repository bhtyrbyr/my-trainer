import { Component, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/errors'

type Props = WithTranslation & { children: ReactNode }
type State = { error: unknown }

/** Last line of defence for render-time crashes: a readable screen with a reload action instead of a blank page. */
class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
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
      </div>
    )
  }
}

export const ErrorBoundary = withTranslation('common')(Boundary)
