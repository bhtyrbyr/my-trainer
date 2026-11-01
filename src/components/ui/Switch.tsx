import { cn } from '@/lib/utils'

/** iOS-style switch with a 44 px hit area; volt track when on. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 w-[60px] shrink-0 items-center justify-center disabled:opacity-50"
    >
      <span
        className={cn(
          'relative h-[30px] w-[50px] rounded-full transition-colors duration-200',
          checked ? 'bg-volt' : 'bg-raised ring-1 ring-inset ring-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] size-6 rounded-full transition-[left,background-color] duration-200',
            checked ? 'left-[23px] bg-volt-ink' : 'left-[3px] bg-ink-muted',
          )}
        />
      </span>
    </button>
  )
}
