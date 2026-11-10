import { describe, expect, it } from 'vitest'
import { energy, energyIn, energyScale } from './common'

// The app shows kWh everywhere (no kWh→MWh→GWh stepping), so the unit never changes between views or
// between points on one chart. energy() formats a standalone value; energyIn() formats in a given
// scale (what a line-chart tooltip uses so it always matches its axis). These guard that choice.
describe('energy unit helpers (kWh everywhere)', () => {
  it('energy() always reads in kWh with thousands separators, however large', () => {
    expect(energy(8_000)).toBe('8,000 kWh')
    expect(energy(120_000)).toBe('120,000 kWh') // not "120.0 MWh"
    expect(energy(7_100_000)).toBe('7,100,000 kWh') // not "7.1 GWh"
  })

  it('energyScale() is always kWh (div 1), so every chart axis reads kWh', () => {
    expect(energyScale(170_000)).toMatchObject({ unit: 'kWh', div: 1 })
    expect(energyScale(9_000_000)).toMatchObject({ unit: 'kWh', div: 1 })
  })

  it('energyIn() formats whole kWh in the given scale — a chart never flips units between points', () => {
    const scale = energyScale(170_000)
    expect(energyIn(90_000, scale)).toBe('90,000 kWh')
    expect(energyIn(170_000, scale)).toBe('170,000 kWh')
    expect(energyIn(8_000, scale)).toBe('8,000 kWh')
  })
})
