import { ChevronLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** History back when the user came from inside the app; otherwise (deep link, reload) go to `fallback`. */
export function BackButton({ fallback, label, className }: { fallback: string; label: string; className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const canGoBack = location.key !== 'default'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn('shrink-0 text-ink', className)}
      onClick={() => (canGoBack ? navigate(-1) : navigate(fallback))}
    >
      <ChevronLeft className="size-6" aria-hidden />
    </Button>
  )
}
