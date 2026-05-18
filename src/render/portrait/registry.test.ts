import { beforeEach, describe, expect, it } from 'vitest'
import { listKnownProviders, resolveActivePortraitProvider } from './registry'
import { usePortraitPrefs } from './prefs'
import { markTestMode, __resetTestModeForTests } from '../../test/state'
import { placeholderProvider } from './providers/placeholder'

const FC_ID = 'fc-pregmod'
const PLACEHOLDER_ID = 'placeholder'

beforeEach(() => {
  __resetTestModeForTests()
  usePortraitPrefs.setState({ portraitProvider: FC_ID })
})

describe('resolveActivePortraitProvider', () => {
  it('returns placeholder when test mode skips assets, regardless of pref', async () => {
    markTestMode({ skipAssets: true })
    const provider = await resolveActivePortraitProvider()
    expect(provider).toBe(placeholderProvider)
  })

  it('falls back to placeholder for an unknown id', async () => {
    usePortraitPrefs.setState({ portraitProvider: 'does-not-exist' })
    const provider = await resolveActivePortraitProvider()
    expect(provider).toBe(placeholderProvider)
  })

  it('returns placeholder when explicitly preferred', async () => {
    usePortraitPrefs.setState({ portraitProvider: PLACEHOLDER_ID })
    const provider = await resolveActivePortraitProvider()
    expect(provider.id).toBe(PLACEHOLDER_ID)
  })
})

describe('listKnownProviders', () => {
  it('lists fc-pregmod first and placeholder last', () => {
    const list = listKnownProviders()
    expect(list[0].id).toBe(FC_ID)
    expect(list[list.length - 1].id).toBe(PLACEHOLDER_ID)
  })

  it('provides a displayName for every entry, including the not-yet-loaded fc-pregmod', () => {
    const list = listKnownProviders()
    for (const { displayName } of list) {
      expect(displayName.length).toBeGreaterThan(0)
    }
    const fc = list.find((p) => p.id === FC_ID)
    expect(fc?.displayName).toBe('FC 矢量立绘')
  })
})
