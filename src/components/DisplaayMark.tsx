import { useId } from 'react'
import { cn } from '@/lib/utils'

/** Displaay wordmark disc. Uses `currentColor` so it follows light/dark text. */
export function DisplaayMark({ className }: { className?: string }) {
  const clipId = useId()
  return (
    <svg
      viewBox="0 0 41 40"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <g clipPath={`url(#${clipId})`}>
        <path d="M25.3785 38.6849C30.5426 35.7769 34.2118 28.5345 34.2118 20.0554C34.2118 11.5763 30.5313 4.23367 25.3672 1.31445C27.9039 5.57072 29.2403 12.9579 29.2403 20.0554C29.2403 27.1529 27.9039 34.4509 25.3785 38.6849Z" />
        <path d="M19.2521 40V0C8.53889 0.590529 0 9.34819 0 20.0557C0 30.7632 8.53889 39.4095 19.2521 40Z" />
        <path d="M26.9742 20.0561C26.9742 9.62709 24.2789 1.97249 21.5156 0.290039V39.7107C24.2902 38.0282 26.9742 30.4293 26.9742 20.0672V20.0561Z" />
        <path d="M30.3047 2.50684C34.0532 6.59597 36.4767 12.9358 36.4767 20.0667C36.4767 27.1976 34.0645 33.4261 30.3273 37.5041C36.5446 34.0723 40.7688 27.5542 40.7688 20.0667C40.7688 12.5793 36.5446 5.96088 30.3047 2.50684Z" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="40.7692" height="40" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}
