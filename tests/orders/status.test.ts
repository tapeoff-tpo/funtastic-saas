import { describe, it, expect } from 'vitest'
import {
  OrderStatus,
  ORDER_STATUS_LABELS,
  VALID_TRANSITIONS,
  isValidTransition,
} from '@/lib/orders/types'

describe('OrderStatus', () => {
  describe('ORDER_STATUS_LABELS', () => {
    it('maps all statuses to Korean labels', () => {
      expect(ORDER_STATUS_LABELS['new']).toBe('신규')
      expect(ORDER_STATUS_LABELS['confirmed']).toBe('확인')
      expect(ORDER_STATUS_LABELS['preparing']).toBe('출고대기')
      expect(ORDER_STATUS_LABELS['shipped']).toBe('출고완료')
      expect(ORDER_STATUS_LABELS['delivering']).toBe('배송중')
      expect(ORDER_STATUS_LABELS['delivered']).toBe('배송완료')
      expect(ORDER_STATUS_LABELS['cancelled']).toBe('취소')
    })

    it('has labels for all 7 statuses', () => {
      expect(Object.keys(ORDER_STATUS_LABELS)).toHaveLength(7)
    })
  })

  describe('VALID_TRANSITIONS', () => {
    it('allows new -> confirmed', () => {
      expect(VALID_TRANSITIONS['new']).toContain('confirmed')
    })

    it('allows new -> cancelled', () => {
      expect(VALID_TRANSITIONS['new']).toContain('cancelled')
    })

    it('allows confirmed -> preparing', () => {
      expect(VALID_TRANSITIONS['confirmed']).toContain('preparing')
    })

    it('allows preparing -> shipped', () => {
      expect(VALID_TRANSITIONS['preparing']).toContain('shipped')
    })

    it('allows shipped -> delivering', () => {
      expect(VALID_TRANSITIONS['shipped']).toContain('delivering')
    })

    it('allows delivering -> delivered', () => {
      expect(VALID_TRANSITIONS['delivering']).toContain('delivered')
    })

    it('has no transitions from delivered (terminal)', () => {
      expect(VALID_TRANSITIONS['delivered']).toEqual([])
    })

    it('has no transitions from cancelled (terminal)', () => {
      expect(VALID_TRANSITIONS['cancelled']).toEqual([])
    })
  })

  describe('isValidTransition', () => {
    it('returns true for valid transitions', () => {
      expect(isValidTransition('new', 'confirmed')).toBe(true)
      expect(isValidTransition('new', 'cancelled')).toBe(true)
      expect(isValidTransition('confirmed', 'preparing')).toBe(true)
      expect(isValidTransition('confirmed', 'cancelled')).toBe(true)
      expect(isValidTransition('preparing', 'shipped')).toBe(true)
      expect(isValidTransition('preparing', 'cancelled')).toBe(true)
      expect(isValidTransition('shipped', 'delivering')).toBe(true)
      expect(isValidTransition('delivering', 'delivered')).toBe(true)
    })

    it('returns false for invalid transitions', () => {
      expect(isValidTransition('new', 'delivered')).toBe(false)
      expect(isValidTransition('new', 'shipped')).toBe(false)
      expect(isValidTransition('confirmed', 'delivered')).toBe(false)
      expect(isValidTransition('delivered', 'new')).toBe(false)
      expect(isValidTransition('cancelled', 'new')).toBe(false)
      expect(isValidTransition('shipped', 'new')).toBe(false)
    })

    it('returns false for self-transitions', () => {
      expect(isValidTransition('new', 'new')).toBe(false)
      expect(isValidTransition('confirmed', 'confirmed')).toBe(false)
    })
  })
})
