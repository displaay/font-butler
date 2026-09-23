import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ActionStatus, type ActionStatusAction } from '@/components/ActionStatus'

type SetActionStatus = (message: string | null, action?: ActionStatusAction) => void
type ClearActionStatusIf = (matches: (message: string) => boolean) => void

const SetActionStatusContext = createContext<SetActionStatus>(() => {})
const ClearActionStatusIfContext = createContext<ClearActionStatusIf>(() => {})

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ message: string; action?: ActionStatusAction } | null>(null)
  const setActionStatus = useCallback<SetActionStatus>((next, action) => {
    setStatus(next ? { message: next, action } : null)
  }, [])
  const clearActionStatusIf = useCallback<ClearActionStatusIf>((matches) => {
    setStatus((current) => (current && matches(current.message) ? null : current))
  }, [])

  return (
    <SetActionStatusContext.Provider value={setActionStatus}>
      <ClearActionStatusIfContext.Provider value={clearActionStatusIf}>
        {children}
        <ActionStatus message={status?.message ?? null} action={status?.action} />
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
