export function AaPreview({
  family,
  weight = 400,
  italic = false,
}: {
  family: string
  weight?: number
  italic?: boolean
}) {
  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-white text-[27px] leading-none text-foreground shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)]">
      <span
        className="translate-y-px select-none"
        style={{
          fontFamily: `"${family}", ui-sans-serif, system-ui`,
          fontWeight: weight,
          fontStyle: italic ? 'italic' : 'normal',
        }}
      >
        Aa
      </span>
    </div>
  )
}
