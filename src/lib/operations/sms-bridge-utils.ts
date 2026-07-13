import { createHash, randomBytes } from 'node:crypto'

export function hashSmsBridgeToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function createSmsBridgeToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function isPicklePlusMessage(sender: string | null | undefined, body: string) {
  const source = `${sender || ''} ${body}`.replace(/\s+/g, '').toLowerCase()
  return source.includes('피클플러스') || source.includes('pickleplus')
}

export function extractVerificationCode(body: string) {
  const contextual = body.match(/(?:인증(?:번호|코드)?|verificationcode|verifycode|otp|code)[^0-9]{0,16}([0-9]{4,8})/i)
  if (contextual?.[1]) return contextual[1]
  return body.match(/(?:^|\D)([0-9]{4,8})(?:\D|$)/)?.[1] || null
}
