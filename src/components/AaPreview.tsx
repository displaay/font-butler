export function AaPreview({
  family,
  weight = 400,
  italic = false,
  size = 'md',
}: {
  family: string
  weight?: number
  italic?: boolean
  size?: 'sm' | 'md' | 'lg' | number
}) {
  const custom = typeof size === 'number'
  const box = custom
    ? 'w-full overflow-hidden rounded-none border-b border-border'
    : size === 'sm'
      ? 'size-8 text-[17px] rounded-md'
      : size === 'lg'
        ? 'min-h-[8.5rem] w-full text-[4.25rem] rounded-none border-b border-border'
        : 'size-11 text-[24px] rounded-md'
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-muted/40 leading-none text-foreground shadow-[inset_0_0_0_1px_var(--border)] ${box}`}
      style={
        custom
          ? { fontSize: `${size}rem`, minHeight: `${size * 2}rem` }
          : undefined
      }
    >
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
