export function consumeSseBuffer(buffer: string, onData: (data: string) => void): string {
  const chunks = buffer.split('\n\n')
  const rest = chunks.pop() ?? ''
  for (const chunk of chunks) {
    const line = chunk.split('\n').find((item) => item.startsWith('data:'))
    if (!line) continue
    onData(line.slice(5).trim())
  }
  return rest
}
