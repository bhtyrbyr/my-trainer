import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-button)] font-semibold tracking-[-0.01em] transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none active:scale-[0.985]',
  {
    variants: {
      variant: {
        primary: 'inner-glow bg-volt text-volt-ink hover:bg-volt-hover disabled:bg-raised disabled:text-ink-faint disabled:shadow-none',
        secondary: 'hairline bg-raised text-ink hover:bg-raised/70 disabled:text-ink-faint',
        ghost: 'text-ink-muted hover:bg-raised hover:text-ink disabled:text-ink-faint',
        danger: 'bg-danger text-ink hover:brightness-110 disabled:bg-raised disabled:text-ink-faint',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[15px]',
        lg: 'h-14 px-6 text-[17px]',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})
