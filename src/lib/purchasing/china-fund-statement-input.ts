export type ChinaFundStatementDirection = 'china_advance' | 'company_remittance' | 'settled'

export type ChinaFundStatementRow = {
  occurredOn: string
  signedAmountCny: number
  balanceAfterCny: number
}

export type ChinaFundStatementRowErrorCode =
  | 'column_count'
  | 'invalid_date'
  | 'invalid_amount'
  | 'invalid_balance'
  | 'date_order'
  | 'balance_discontinuity'

export type ChinaFundStatementRowError = {
  lineNumber: number
  raw: string
  code: ChinaFundStatementRowErrorCode
  message: string
}

export type ChinaFundStatementParseResult = {
  entries: ChinaFundStatementRow[]
  errors: ChinaFundStatementRowError[]
  inferredOpeningBalanceCny: number | null
  advanceTotalCny: number
  remittanceTotalCny: number
  finalBalanceCny: number | null
}

export type ChinaFundStatementDraftInputRow = {
  occurredOn: string
  signedAmountCny: number | null
  memo?: string | null
}

export type ChinaFundStatementDraftError = {
  rowNumber: number
  message: string
}

export type ChinaFundStatementDraftResult = {
  entries: Array<ChinaFundStatementRow & { memo: string | null }>
  errors: ChinaFundStatementDraftError[]
  balanceAfterCnyByRow: Array<number | null>
  openingBalanceCny: number
  finalBalanceCny: number
}

export type ChinaFundStatementSummary = {
  chinaAdvanceCny: number
  companyRemittanceCny: number
  netChangeCny: number
  finalBalanceCny: number | null
}

export type ChinaFundStatementOcrExtraction = {
  text: string
  recognizedCount: number
  ignoredLineCount: number
}

const BALANCE_TOLERANCE_CNY = 0.01

/**
 * Parses three-column text copied from Excel:
 * date / signed amount / balance after the entry.
 *
 * The signs follow the counterparty's (China-side) statement:
 * positive means China advanced funds, while negative means the company remitted funds.
 */
export function parseChinaFundStatementText(text: string): ChinaFundStatementParseResult {
  const parsedRows: Array<ChinaFundStatementRow & { lineNumber: number; raw: string }> = []
  const errors: ChinaFundStatementRowError[] = []

  for (const [index, rawLine] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const raw = rawLine.trim()
    if (!raw || isHeaderLine(raw)) continue

    const columns = splitStatementColumns(raw)
    if (columns.length !== 3) {
      errors.push({
        lineNumber,
        raw,
        code: 'column_count',
        message: `3개 열(날짜, 금액, 총합)이 필요하지만 ${columns.length}개 열을 찾았습니다.`,
      })
      continue
    }

    const occurredOn = parseStatementDate(columns[0])
    const signedAmountCny = parseCnyAmount(columns[1])
    const balanceAfterCny = parseCnyAmount(columns[2])

    if (!occurredOn) {
      errors.push({
        lineNumber,
        raw,
        code: 'invalid_date',
        message: `날짜를 확인해주세요: ${columns[0] || '(비어 있음)'}`,
      })
    }
    if (signedAmountCny === null || signedAmountCny === 0) {
      errors.push({
        lineNumber,
        raw,
        code: 'invalid_amount',
        message: signedAmountCny === 0
          ? '금액은 0이 아닌 값이어야 합니다.'
          : `금액을 확인해주세요: ${columns[1] || '(비어 있음)'}`,
      })
    }
    if (balanceAfterCny === null) {
      errors.push({
        lineNumber,
        raw,
        code: 'invalid_balance',
        message: `총합을 확인해주세요: ${columns[2] || '(비어 있음)'}`,
      })
    }
    if (!occurredOn || signedAmountCny === null || signedAmountCny === 0 || balanceAfterCny === null) continue

    parsedRows.push({
      occurredOn,
      signedAmountCny,
      balanceAfterCny,
      lineNumber,
      raw,
    })
  }

  for (let index = 1; index < parsedRows.length; index += 1) {
    const previous = parsedRows[index - 1]
    const current = parsedRows[index]
    if (current.occurredOn < previous.occurredOn) {
      errors.push({
        lineNumber: current.lineNumber,
        raw: current.raw,
        code: 'date_order',
        message: '날짜가 앞 행보다 이전입니다. 날짜순으로 붙여넣어주세요.',
      })
    }
    const expectedBalance = roundCny(previous.balanceAfterCny + current.signedAmountCny)
    if (Math.abs(expectedBalance - current.balanceAfterCny) <= BALANCE_TOLERANCE_CNY + Number.EPSILON) {
      continue
    }

    errors.push({
      lineNumber: current.lineNumber,
      raw: current.raw,
      code: 'balance_discontinuity',
      message: `이전 총합과 금액으로 계산한 총합은 ${formatCny(expectedBalance)}元이지만 입력값은 ${formatCny(current.balanceAfterCny)}元입니다.`,
    })
  }

  const entries = parsedRows.map(({ occurredOn, signedAmountCny, balanceAfterCny }) => ({
    occurredOn,
    signedAmountCny,
    balanceAfterCny,
  }))
  const summary = summarizeChinaFundStatement(entries)
  const firstRow = parsedRows[0]
  return {
    entries,
    errors,
    inferredOpeningBalanceCny: firstRow
      ? roundCny(firstRow.balanceAfterCny - firstRow.signedAmountCny)
      : null,
    advanceTotalCny: summary.chinaAdvanceCny,
    remittanceTotalCny: summary.companyRemittanceCny,
    finalBalanceCny: summary.finalBalanceCny,
  }
}

/** Builds the server-ready rows and running balances for the manual input table. */
export function buildChinaFundStatementDraft(
  openingBalanceCny: number,
  rows: readonly ChinaFundStatementDraftInputRow[],
): ChinaFundStatementDraftResult {
  const safeOpeningBalanceCny = Number.isFinite(openingBalanceCny)
    ? roundCny(openingBalanceCny)
    : 0
  const entries: Array<ChinaFundStatementRow & { memo: string | null }> = []
  const errors: ChinaFundStatementDraftError[] = []
  const balanceAfterCnyByRow: Array<number | null> = rows.map(() => null)
  let runningBalanceCny = safeOpeningBalanceCny
  let previousOccurredOn: string | null = null

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1
    const occurredOnInput = row.occurredOn.trim()
    const hasDate = occurredOnInput.length > 0
    const hasAmount = row.signedAmountCny !== null

    if (!hasDate && !hasAmount) continue

    if (!hasDate || !hasAmount) {
      errors.push({
        rowNumber,
        message: !hasDate ? '날짜를 선택해주세요.' : '중국 기준 금액을 입력해주세요.',
      })
      continue
    }

    const occurredOn = parseStatementDate(occurredOnInput)
    if (!occurredOn) {
      errors.push({ rowNumber, message: '날짜를 확인해주세요.' })
      continue
    }

    const signedAmountCny = row.signedAmountCny
    if (!Number.isFinite(signedAmountCny) || signedAmountCny === 0) {
      errors.push({ rowNumber, message: '금액은 0이 아닌 숫자여야 합니다.' })
      continue
    }
    if (Math.abs(roundCny(signedAmountCny) - signedAmountCny) > Number.EPSILON) {
      errors.push({ rowNumber, message: '금액은 소수점 둘째 자리까지만 입력해주세요.' })
      continue
    }
    if (previousOccurredOn && occurredOn < previousOccurredOn) {
      errors.push({ rowNumber, message: '날짜가 앞 행보다 이전입니다. 날짜순으로 입력해주세요.' })
    }

    const roundedAmountCny = roundCny(signedAmountCny)
    runningBalanceCny = roundCny(runningBalanceCny + roundedAmountCny)
    balanceAfterCnyByRow[index] = runningBalanceCny
    entries.push({
      occurredOn,
      signedAmountCny: roundedAmountCny,
      balanceAfterCny: runningBalanceCny,
      memo: row.memo?.trim() || null,
    })
    previousOccurredOn = occurredOn
  }

  return {
    entries,
    errors,
    balanceAfterCnyByRow,
    openingBalanceCny: safeOpeningBalanceCny,
    finalBalanceCny: runningBalanceCny,
  }
}

export function chinaFundStatementDirection(
  signedAmountCny: number,
): ChinaFundStatementDirection {
  if (signedAmountCny > 0) return 'china_advance'
  if (signedAmountCny < 0) return 'company_remittance'
  return 'settled'
}

/** Converts the China-side statement sign into the company's internal balance change. */
export function chinaFundStatementAmountToInternalBalanceChange(signedAmountCny: number) {
  return roundCny(-signedAmountCny)
}

export function summarizeChinaFundStatement(
  rows: readonly ChinaFundStatementRow[],
): ChinaFundStatementSummary {
  const chinaAdvanceCny = roundCny(rows.reduce((sum, row) => (
    row.signedAmountCny > 0 ? sum + row.signedAmountCny : sum
  ), 0))
  const companyRemittanceCny = roundCny(rows.reduce((sum, row) => (
    row.signedAmountCny < 0 ? sum + Math.abs(row.signedAmountCny) : sum
  ), 0))

  return {
    chinaAdvanceCny,
    companyRemittanceCny,
    netChangeCny: roundCny(chinaAdvanceCny - companyRemittanceCny),
    finalBalanceCny: rows.length > 0 ? rows[rows.length - 1].balanceAfterCny : null,
  }
}

/**
 * Converts OCR output from a screenshot of the China deposit table into the
 * same three-column text used to populate the manual input table.
 */
export function extractChinaFundStatementTextFromOcr(
  text: string,
): ChinaFundStatementOcrExtraction {
  const rows: ChinaFundStatementRow[] = []
  let ignoredLineCount = 0

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const row = parseOcrStatementRow(rawLine)
    if (row) rows.push(row)
    else if (rawLine.trim()) ignoredLineCount += 1
  }

  const reverseRows = [...rows].reverse()
  const dateIsDescending = rows.length > 1 && rows[0]!.occurredOn > rows.at(-1)!.occurredOn
  const balancesOnlyContinueWhenReversed = rows.length > 1
    && !hasOcrBalanceContinuity(rows)
    && hasOcrBalanceContinuity(reverseRows)
  const orderedRows = dateIsDescending || balancesOnlyContinueWhenReversed
    ? reverseRows
    : rows

  return {
    text: orderedRows
      .map((row) => `${row.occurredOn}\t${formatOcrAmount(row.signedAmountCny)}\t${formatOcrAmount(row.balanceAfterCny)}`)
      .join('\n'),
    recognizedCount: orderedRows.length,
    ignoredLineCount,
  }
}

function splitStatementColumns(line: string) {
  const tabColumns = trimEmptyEdgeColumns(line.split('\t').map((value) => value.trim()))
  if (tabColumns.length > 1) return tabColumns

  const pipeColumns = trimEmptyEdgeColumns(line.split('|').map((value) => value.trim()))
  if (pipeColumns.length > 1) return pipeColumns

  const match = line.match(
    /^(\d{4}\s*(?:[.\/-]|년)\s*\d{1,2}\s*(?:[.\/-]|월)\s*\d{1,2}(?:\s*일)?\.?)\s+(.+?)\s+([^\s]+)\s*$/,
  )
  return match ? [match[1], match[2], match[3]] : [line]
}

function parseOcrStatementRow(rawLine: string): ChinaFundStatementRow | null {
  const line = rawLine.trim()
  const dateMatch = line.match(/\d{4}\s*(?:[.\/-]|년)\s*\d{1,2}\s*(?:[.\/-]|월)\s*\d{1,2}(?:\s*일)?\.?/)
  if (!dateMatch) return null

  const occurredOn = parseStatementDate(dateMatch[0])
  if (!occurredOn) return null

  const rest = line.slice((dateMatch.index ?? 0) + dateMatch[0].length)
  const amounts = extractOcrAmounts(rest)
  if (amounts.length < 2) return null

  return {
    occurredOn,
    signedAmountCny: amounts[0]!,
    balanceAfterCny: amounts[1]!,
  }
}

function extractOcrAmounts(value: string) {
  const currencyAmounts = Array.from(value.matchAll(
    /([+\-−﹣－]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:元|￥|¥)/g,
  ))
    .map((match) => parseCnyAmount(match[1] ?? ''))
    .filter((amount): amount is number => amount !== null)
  if (currencyAmounts.length >= 2) return currencyAmounts

  const withoutDates = value.replace(/\d{4}\s*(?:[.\/-]|년)\s*\d{1,2}\s*(?:[.\/-]|월)\s*\d{1,2}(?:\s*일)?\.?/g, ' ')
  return Array.from(withoutDates.matchAll(
    /[+\-−﹣－]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g,
  ))
    .map((match) => match[0])
    .filter((raw) => /[+\-−﹣－,.]|\d{2,}/.test(raw.replace(/\s/g, '')))
    .map((raw) => parseCnyAmount(raw))
    .filter((amount): amount is number => amount !== null)
}

function hasOcrBalanceContinuity(rows: readonly ChinaFundStatementRow[]) {
  return rows.every((row, index) => {
    if (index === 0) return true
    const previous = rows[index - 1]!
    return Math.abs(
      roundCny(previous.balanceAfterCny + row.signedAmountCny) - row.balanceAfterCny,
    ) <= BALANCE_TOLERANCE_CNY + Number.EPSILON
  })
}

function trimEmptyEdgeColumns(columns: string[]) {
  let start = 0
  let end = columns.length
  while (start < end && !columns[start]) start += 1
  while (end > start && !columns[end - 1]) end -= 1
  return columns.slice(start, end)
}

function isHeaderLine(line: string) {
  if (/^\s*[-:| ]+\s*$/.test(line)) return true
  const normalized = line.replace(/\s+/g, '').toLocaleLowerCase('ko-KR')
  const containsDateHeader = normalized.includes('날짜') || normalized.includes('日期') || normalized.includes('date')
  const containsAmountHeader = normalized.includes('금액') || normalized.includes('充值') || normalized.includes('amount')
  const containsBalanceHeader = normalized.includes('총합') || normalized.includes('잔액') || normalized.includes('余额') || normalized.includes('balance')
  return containsDateHeader && (containsAmountHeader || containsBalanceHeader)
}

function parseStatementDate(value: string) {
  const match = value.trim().match(
    /^(\d{4})\s*(?:[.\/-]|년)\s*(\d{1,2})\s*(?:[.\/-]|월)\s*(\d{1,2})(?:\s*일)?\.?$/,
  )
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseCnyAmount(value: string) {
  const normalized = value
    .trim()
    .replace(/[−﹣－]/g, '-')
    .replace(/[＋﹢]/g, '+')
    .replace(/[￥¥元,\s]/g, '')
  if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null

  const number = Number(normalized)
  return Number.isFinite(number) ? roundCny(number) : null
}

function formatOcrAmount(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function roundCny(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCny(value: number) {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
