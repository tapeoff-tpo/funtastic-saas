'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { useTransition, type ComponentProps, type MouseEvent } from 'react'

type PaymentFlowPendingLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string
}

/**
 * Keeps the current list visible while the next server-rendered payment-flow
 * selection is loading, but gives the clicked control immediate feedback.
 */
export function PaymentFlowPendingLink({
  href,
  children,
  className,
  onClick,
  scroll,
  replace,
  ...props
}: PaymentFlowPendingLinkProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)

    // Preserve browser behavior for a new tab/window and for custom handlers.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    startTransition(() => {
      if (replace) {
        router.replace(href, { scroll })
      } else {
        router.push(href, { scroll })
      }
    })
  }

  return (
    <Link
      {...props}
      href={href}
      scroll={scroll}
      replace={replace}
      onClick={handleClick}
      aria-busy={isPending || undefined}
      data-pending={isPending ? 'true' : undefined}
      className={`${className ?? ''} relative${isPending ? ' cursor-progress' : ''}`}
    >
      {children}
      {isPending ? (
        <span className="pointer-events-none absolute inset-0 z-10 inline-flex items-center justify-center gap-1 rounded-[inherit] bg-background/80 text-xs font-medium text-foreground" role="status">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          조회 중
        </span>
      ) : null}
    </Link>
  )
}
