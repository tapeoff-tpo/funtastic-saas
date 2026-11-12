import postgres from 'postgres'

const LOCK_NAMESPACE = 'funtastic-heavy-data-operation'

type LockRow = {
  acquired: boolean
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
  // The application pool has one connection. Holding that connection while
  // operation() calls db would queue the operation behind its own lock.
  // This short-lived connection holds only the advisory lock, leaving the
  // application connection free for the import's queries and transactions.
  const lockClient = postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    fetch_types: false,
    connection: {
      application_name: 'funtastic-data-operation-lock',
      // Release the lock if a five-minute serverless invocation is terminated.
      idle_in_transaction_session_timeout: 330_000,
    },
  })
  try {
    const completed = await lockClient.begin(async (lockSql) => {
      const [lock] = await lockSql.unsafe<LockRow[]>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
        [`${LOCK_NAMESPACE}:${userId}`],
      )
      if (!lock?.acquired) throw new WorkspaceDataOperationInProgressError()
      return { value: await operation() }
    })
    return completed.value
  } finally {
    await lockClient.end({ timeout: 5 })
  }
}
