export function desktopPathForFile(file: File): string | undefined {
  const getter =
    typeof window !== 'undefined' ? window.fontButlerDesktop?.getPathForFile : undefined
  if (getter) {
    try {
      const value = getter(file)
      if (value?.trim()) return value.trim()
    } catch {
      // The File is not backed by a native path.
    }
  }
  const value = (file as File & { path?: string }).path
  return value?.trim() ? value.trim() : undefined
}
