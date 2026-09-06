export type DoneToastAction =
  | { kind: 'retry'; label: 'Retry failed' }
  | { kind: 'undo'; label: 'Undo'; operationId: string }
  | { kind: 'activity'; label: 'Activity'; operationId?: string }

export function doneToastAction(input: {
  failedIds?: string[]
  operationId?: string
  undo?: boolean
}): DoneToastAction {
  if (input.failedIds?.length) {
    return { kind: 'retry', label: 'Retry failed' }
  }
  if (input.undo && input.operationId) {
    return { kind: 'undo', label: 'Undo', operationId: input.operationId }
  }
  if (input.operationId) {
    return { kind: 'activity', label: 'Activity', operationId: input.operationId }
  }
  return { kind: 'activity', label: 'Activity' }
}

export function latestUndoableOperationId(
  operations: Array<{ id: string; action: string; undoable: boolean; undone: boolean }>,
  action: string,
): string | undefined {
  return operations.find(
    (operation) => operation.action === action && operation.undoable && !operation.undone,
  )?.id
}
