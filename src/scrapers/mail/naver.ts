import tls from 'node:tls'

interface NaverMailCodeOptions {
  email: string
  password: string
  since?: Date
  receivedAfter?: Date
  timeoutMs?: number
  pollIntervalMs?: number
  fromHints?: string[]
  subjectHints?: string[]
  onlyUnread?: boolean
}

const IMAP_HOST = 'imap.naver.com'
const IMAP_PORT = 993
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_POLL_INTERVAL_MS = 5_000

function escapeImapString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function formatImapDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`
}

function decodeMimeWord(input: string): string {
  return input.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_all, charset: string, encoding: string, value: string) => {
    try {
      const normalizedCharset = charset.toLowerCase()
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(value, 'base64')
        : Buffer.from(value.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), 'binary')

      if (normalizedCharset.includes('utf-8')) return bytes.toString('utf8')
      if (normalizedCharset.includes('euc-kr') || normalizedCharset.includes('ks_c_5601')) {
        return new TextDecoder('euc-kr').decode(bytes)
      }
      return bytes.toString('utf8')
    } catch {
      return value
    }
  })
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function extractVerificationCode(message: string): string | null {
  const decoded = decodeMimeWord(stripHtml(decodeQuotedPrintable(message)))
  const focusedPatterns = [
    /(?:인증\s*(?:번호|코드)|verification\s*code|security\s*code)[^\d]{0,40}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,20}(?:인증\s*(?:번호|코드)|verification\s*code|security\s*code)/i,
  ]

  for (const pattern of focusedPatterns) {
    const match = decoded.match(pattern)
    if (match?.[1]) return match[1]
  }

  const candidates = [...decoded.matchAll(/\b(\d{6})\b/g)].map((match) => match[1])
  return candidates.at(-1) ?? null
}

function extractMessageDate(message: string): Date | null {
  const dateHeader = message.match(/^Date:\s*(.+)$/im)?.[1]?.trim()
  if (!dateHeader) return null
  const date = new Date(dateHeader)
  return Number.isNaN(date.getTime()) ? null : date
}

class SimpleImapClient {
  private socket: tls.TLSSocket | null = null
  private buffer = ''
  private tagCounter = 0

  async connect(): Promise<void> {
    this.socket = tls.connect({ host: IMAP_HOST, port: IMAP_PORT, servername: IMAP_HOST })
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk) => {
      this.buffer += chunk
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('네이버 메일 IMAP 연결 시간이 초과되었습니다.')), 15_000)
      this.socket?.once('secureConnect', () => {
        clearTimeout(timer)
        resolve()
      })
      this.socket?.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    await this.waitFor(/\* OK/i, 15_000)
  }

  async login(email: string, password: string): Promise<void> {
    await this.command(`LOGIN "${escapeImapString(email)}" "${escapeImapString(password)}"`)
  }

  async selectInbox(): Promise<void> {
    await this.command('SELECT INBOX')
  }

  async searchRecent(since: Date, fromHints: string[], options: { onlyUnread?: boolean } = {}): Promise<number[]> {
    const sincePart = `SINCE ${formatImapDate(since)}`
    const unreadPart = options.onlyUnread ? ' UNSEEN' : ''
    const responses: number[] = []

    for (const from of fromHints.length > 0 ? fromHints : ['']) {
      const query = from ? `${sincePart}${unreadPart} FROM "${escapeImapString(from)}"` : `${sincePart}${unreadPart}`
      const response = await this.command(`UID SEARCH ${query}`)
      const ids = response
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = line.match(/^\* SEARCH\s+(.+)$/i)
          return match ? match[1].trim().split(/\s+/).map(Number) : []
        })
        .filter((id) => Number.isFinite(id))
      responses.push(...ids)
    }

    return [...new Set(responses)].sort((a, b) => b - a).slice(0, 20)
  }

  async fetchMessage(uid: number): Promise<string> {
    return this.command(`UID FETCH ${uid} (BODY.PEEK[])`, 20_000)
  }

  close(): void {
    this.socket?.end()
    this.socket?.destroy()
    this.socket = null
  }

  private async command(command: string, timeoutMs = 15_000): Promise<string> {
    const tag = `A${String(++this.tagCounter).padStart(4, '0')}`
    this.socket?.write(`${tag} ${command}\r\n`)
    const response = await this.waitFor(new RegExp(`${tag} (OK|NO|BAD)`, 'i'), timeoutMs)
    if (new RegExp(`${tag} (NO|BAD)`, 'i').test(response)) {
      throw new Error(`네이버 메일 IMAP 명령 실패: ${response.split(/\r?\n/).at(-2) ?? response}`)
    }
    return response
  }

  private async waitFor(pattern: RegExp, timeoutMs: number): Promise<string> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (pattern.test(this.buffer)) {
        const response = this.buffer
        this.buffer = ''
        return response
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('네이버 메일 IMAP 응답 대기 시간이 초과되었습니다.')
  }
}

export async function readNaverVerificationCode(options: NaverMailCodeOptions): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const since = options.since ?? new Date(Date.now() - 10 * 60 * 1000)
  const receivedAfter = options.receivedAfter?.getTime()
  const subjectHints = options.subjectHints ?? ['오늘의집', 'ohou', '인증']
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const client = new SimpleImapClient()
    try {
      await client.connect()
      await client.login(options.email, options.password)
      await client.selectInbox()
      const uids = await client.searchRecent(
        since,
        options.fromHints ?? ['bucketplace', 'ohou', '오늘의집', ''],
        { onlyUnread: options.onlyUnread },
      )

      for (const uid of uids) {
        const message = await client.fetchMessage(uid)
        const messageDate = extractMessageDate(message)
        if (receivedAfter && messageDate && messageDate.getTime() < receivedAfter - 5000) continue
        const decoded = decodeMimeWord(decodeQuotedPrintable(message)).toLowerCase()
        if (!subjectHints.some((hint) => decoded.includes(hint.toLowerCase()))) continue
        const code = extractVerificationCode(message)
        if (code) return code
      }
    } finally {
      client.close()
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return null
}
