import { useState } from 'react'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FamilyDetail } from '../../shared/family-details.ts'

/** Star display for a library card. Renders nothing without a rating. */
export function FamilyRatingBadge({ rating }: { rating?: number | null }) {
  if (!rating) return null
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
      title={`Rated ${rating} of 5`}
      data-family-rating={rating}
    >
      <Star className="size-3 fill-current" />
      {rating}
    </span>
  )
}

/** View and edit one family's star rating and comment (Inspector). */
export function FamilyDetailsEditor({
  familyKey,
  detail,
  onRating,
  onComment,
}: {
  familyKey: string
  detail?: FamilyDetail
  onRating: (familyKey: string, rating: number | null) => void
  onComment: (familyKey: string, comment: string) => void
}) {
  const rating = detail?.rating ?? null
  const storedComment = detail?.comment ?? ''
  // The draft belongs to one family only: switching families discards it, so
  // an unsaved comment can never be saved onto the next family.
  const [draft, setDraft] = useState<{ familyKey: string; text: string } | null>(null)
  const comment = draft && draft.familyKey === familyKey ? draft.text : storedComment

  return (
    <div className="space-y-3" data-family-details>
      <div>
        <h3 className="text-sm font-medium">Rating</h3>
        <div className="mt-1 flex items-center gap-1" role="radiogroup" aria-label="Family rating">
          {[1, 2, 3, 4, 5].map((stars) => (
            <button
              key={stars}
              type="button"
              role="radio"
              aria-checked={rating === stars}
              aria-label={`${stars} star${stars === 1 ? '' : 's'}`}
              className="p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onRating(familyKey, rating === stars ? null : stars)}
            >
              <Star
                className={cn('size-4', rating !== null && stars <= rating && 'fill-current text-foreground')}
              />
            </button>
          ))}
          {rating !== null ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-1 h-6 px-1.5 text-xs"
              onClick={() => onRating(familyKey, null)}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium">Comment</h3>
        <textarea
          value={comment}
          aria-label="Family comment"
          placeholder="Add a comment for this family…"
          className="mt-1 min-h-16 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setDraft({ familyKey, text: event.target.value })}
        />
        <div className="mt-1 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!draft || draft.familyKey !== familyKey || comment === storedComment}
            onClick={() => {
              onComment(familyKey, comment)
              setDraft(null)
            }}
          >
            Save comment
          </Button>
        </div>
      </div>
    </div>
  )
}
