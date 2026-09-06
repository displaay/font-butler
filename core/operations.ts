import crypto from 'node:crypto'
import fs from 'node:fs'
import { operationsPath } from './paths.ts'
import type { AppPaths } from './paths.ts'
import type {
  Operation,
  OperationFile,
  OperationItem,
  OperationOutcome,
  OperationTrigger,
} from './types.ts'

export function loadOperations(paths: AppPaths): Operation[] {
  const file = operationsPath(paths)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as OperationFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.operations)) {
      return []
    }
    return parsed.operations
  } catch {
    return []
  }
}

function saveOperations(paths: AppPaths, operations: Operation[]): void {
  const tmp = `${operationsPath(paths)}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, operations } satisfies OperationFile, null, 2))
  fs.renameSync(tmp, operationsPath(paths))
}

export function createOperation(input: {
  trigger: OperationTrigger
  action: string
  familyName?: string
  destination?: string
  items?: OperationItem[]
  idempotencyKey?: string
}): Operation {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    trigger: input.trigger,
    action: input.action,
    familyName: input.familyName,
    destination: input.destination,
    items: input.items ?? [],
    outcome: 'pending',
    undoable: false,
    undone: false,
    idempotencyKey: input.idempotencyKey,
  }
}

export function findOperationByIdempotency(paths: AppPaths, key: string | undefined): Operation | undefined {
  if (!key) return undefined
  return loadOperations(paths).find((item) => item.idempotencyKey === key)
}

export function upsertOperation(paths: AppPaths, operation: Operation): Operation {
  const operations = loadOperations(paths)
  const index = operations.findIndex((item) => item.id === operation.id)
  if (index === -1) {
    operations.unshift(operation)
  } else {
    operations[index] = operation
  }
  saveOperations(paths, operations)
  return operation
}

export function finishOperation(
  operation: Operation,
  items: OperationItem[],
): Operation {
  operation.items = items
  operation.finishedAt = Date.now()
  const succeeded = items.filter((item) => item.outcome === 'succeeded').length
  const failed = items.filter((item) => item.outcome === 'failed').length
  const canceled = items.filter((item) => item.outcome === 'canceled').length
  if (canceled && succeeded === 0 && failed === 0) {
    operation.outcome = 'canceled'
  } else if (failed && succeeded) {
    operation.outcome = 'partial'
  } else if (failed) {
    operation.outcome = 'failed'
  } else {
    operation.outcome = 'succeeded'
  }
  operation.undoable =
    succeeded > 0 &&
    operation.action !== 'clear-caches' &&
    operation.action !== 'trash-source' &&
    operation.action !== 'repair' &&
    operation.action !== 'undo' &&
    operation.action !== 'recover-journal'
  return operation
}

export function operationCounts(operation: Operation): {
  succeeded: number
  failed: number
  skipped: number
  canceled: number
} {
  return {
    succeeded: operation.items.filter((item) => item.outcome === 'succeeded').length,
    failed: operation.items.filter((item) => item.outcome === 'failed').length,
    skipped: operation.items.filter((item) => item.outcome === 'skipped').length,
    canceled: operation.items.filter((item) => item.outcome === 'canceled').length,
  }
}

export function pruneOperations(
  paths: AppPaths,
  options: { maxAgeMs: number; maxCount: number },
): void {
  const cutoff = Date.now() - options.maxAgeMs
  let operations = loadOperations(paths).filter((item) => item.startedAt >= cutoff)
  if (operations.length > options.maxCount) {
    operations = operations.slice(0, options.maxCount)
  }
  saveOperations(paths, operations)
}

export function markUndone(paths: AppPaths, id: string): Operation | undefined {
  const operations = loadOperations(paths)
  const operation = operations.find((item) => item.id === id)
  if (!operation) return undefined
  operation.undone = true
  operation.undoable = false
  saveOperations(paths, operations)
  return operation
}

export function summarizeOperation(operation: Operation): string {
  const counts = operationCounts(operation)
  const bits = [
    counts.succeeded ? `${counts.succeeded} succeeded` : '',
    counts.failed ? `${counts.failed} failed` : '',
    counts.skipped ? `${counts.skipped} skipped` : '',
    counts.canceled ? `${counts.canceled} canceled` : '',
  ].filter(Boolean)
  return bits.join(', ') || operation.outcome
}

export function outcomeFromCounts(counts: {
  succeeded: number
  failed: number
  canceled: number
}): OperationOutcome {
  if (counts.canceled && counts.succeeded === 0 && counts.failed === 0) return 'canceled'
  if (counts.failed && counts.succeeded) return 'partial'
  if (counts.failed && counts.succeeded === 0) return 'failed'
  return 'succeeded'
}
