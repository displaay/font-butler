export function AaPreview({
  family,
  weight = 400,
  italic = false,
  size = 'md',
}: {
  family: string
  weight?: number
  italic?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  const box =
    size === 'sm'
      ? 'size-8 text-[17px] rounded-[7px]'
      : size === 'lg'
        ? 'min-h-[8.5rem] w-full text-[4.25rem] rounded-none border-b border-stone-900/5'
        : 'size-12 text-[27px] rounded-[10px]'
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-white leading-none text-foreground shadow-[inset_0_0_0_1px_rgba(28,25,23,0.06)] ${box}`}
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
