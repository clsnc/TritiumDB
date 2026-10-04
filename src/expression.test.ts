import { describe, it, expect } from 'vitest'
import { expr } from './expression'

describe('Expression', () => {
  it('toString produces correct JSON with named and anonymous predicates', () => {
    function namedPred(x: number, y: string) { return undefined }

    expect(expr(namedPred, 1, 'hello').toString()).toBe(
      JSON.stringify({ pred: 'namedPred', args: [1, 'hello'] })
    )
    expect(expr(() => undefined).toString()).toBe(
      JSON.stringify({ pred: 'anonymous', args: [] })
    )
  })
})
