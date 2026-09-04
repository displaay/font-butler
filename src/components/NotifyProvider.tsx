import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ActionStatus } from '@/components/ActionStatus'

const SetActionStatusContext = createContext<(message: string | null) => void>(() => {})

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const setActionStatus = useCallback((next: string | null) => {
    setMessage(next)
  }, [])

  return (
    <SetActionStatusContext.Provider value={setActionStatus}>
      {children}
      <ActionStatus message={message} />
    </SetActionStatusContext.Provider>
  )
}

export function useSetActionStatus() {
  return useContext(SetActionStatusContext)
}
