import { describe, expect, it } from 'vitest'
import { exerciseMediaEnabled } from './media-policy.js'

describe('exerciseMediaEnabled', () => {
  it('is disabled by default', () => {
    expect(exerciseMediaEnabled({})).toBe(false)
  })

  it('stays disabled for generic truthy-looking values', () => {
    expect(exerciseMediaEnabled({ VITE_EXERCISE_MEDIA: 'enabled' })).toBe(false)
    expect(exerciseMediaEnabled({ VITE_EXERCISE_MEDIA: 'true' })).toBe(false)
  })

  it('requires the explicit licensed-media build contract', () => {
    expect(exerciseMediaEnabled({ VITE_EXERCISE_MEDIA: 'licensed' })).toBe(true)
  })
})
