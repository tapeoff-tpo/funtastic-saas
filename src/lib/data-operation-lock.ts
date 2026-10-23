import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

const LOCK_NAMESPACE = 'funtastic-heavy-data-operation'

type LockRow = {
  acquired: boolean
}

function resultRows<T>(result: T[] | { rows?: T[] }) {
  return Array.isArray(result) ? result : result.rows ?? []
}

export class WorkspaceDataOperationInProgressError extends Error {
  constructor() {
    super('다른 엑셀 데이터 반영 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 실행해주세요.')
    this.name = 'WorkspaceDataOperationInProgressError'
  }
}

/**
 * Excel parsing and bulk writes are CPU/DB-heavy. Keep only one such operation
 * active per shared workspace so concurrent imports cannot slow every page.
 */
export async function withWorkspaceDataOperationLock<T>(
  userId: string,
  operation: () => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const [lock] = resultRows<LockRow>(await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(
        hashtext(${`${LOCK_NAMESPACE}:${userId}`})
      ) AS "acquired"
    `))
    if (!lock?.acquired) throw new WorkspaceDataOperationInProgressError()

    return operation()
  })
}
