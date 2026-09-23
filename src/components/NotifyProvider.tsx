import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ActionStatus } from '@/components/ActionStatus'

type SetActionStatus = (message: string | null) => void
type ClearActionStatusIf = (matches: (message: string) => boolean) => void

const SetActionStatusContext = createContext<SetActionStatus>(() => {})
const ClearActionStatusIfContext = createContext<ClearActionStatusIf>(() => {})

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ message: string } | null>(null)
  const setActionStatus = useCallback<SetActionStatus>((next) => {
    setStatus(next ? { message: next } : null)
  }, [])
  const clearActionStatusIf = useCallback<ClearActionStatusIf>((matches) => {
    setStatus((current) => (current && matches(current.message) ? null : current))
  }, [])

  return (
    <SetActionStatusContext.Provider value={setActionStatus}>
      <ClearActionStatusIfContext.Provider value={clearActionStatusIf}>
        {children}
        <ActionStatus message={status?.message ?? null} />
      </ClearActionStatusIfContext.Provider>
    </SetActionStatusContext.Provider>
  )
}

export function useSetActionStatus() {
  return useContext(SetActionStatusContext)
}

/** Clears the status only while it still shows a message this caller owns, never someone else's. */
export function useClearActionStatusIf() {
  return useContext(ClearActionStatusIfContext)
}
