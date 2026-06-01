import { describe, expect, it } from 'vitest'
import { extractVerificationCodeFromMessage } from '@/scrapers/mail/naver'

describe('extractVerificationCodeFromMessage', () => {
  it('extracts a 6 digit Ohouse verification code from Korean mail text', () => {
    const message = [
      'From: "오늘의집" <no-reply@bucketplace.net>',
      'Subject: [오늘의집] 인증번호 확인 안내',
      'Date: Mon, 01 Jun 2026 18:44:06 +0900',
      '',
      '안녕하세요. 오늘의집 인증번호는 994478 입니다.',
      '10분 안에 입력해주세요.',
    ].join('\r\n')

    expect(extractVerificationCodeFromMessage(message, 6)).toBe('994478')
  })

  it('extracts a code when verification wording appears after the number', () => {
    const message = [
      'Subject: verification',
      '',
      '994478 is your security code.',
    ].join('\r\n')

    expect(extractVerificationCodeFromMessage(message, 6)).toBe('994478')
  })
})
