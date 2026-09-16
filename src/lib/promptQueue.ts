type PromptTask = () => Promise<void>

let chain: Promise<void> = Promise.resolve()

export function enqueuePrompt<T>(show: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((outerResolve) => {
    const task: PromptTask = () =>
      new Promise<void>((release) => {
        let settled = false
        show((value) => {
          if (settled) return
          settled = true
          outerResolve(value)
          release()
        })
      })
    chain = chain.then(task, task)
  })
}
