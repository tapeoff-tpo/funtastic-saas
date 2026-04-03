'use client'

export function PrintButtonClient() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      인쇄
    </button>
  )
}
