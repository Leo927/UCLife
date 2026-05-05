// Barrel — preserves the legacy `import from '../ecs/traits'` import path
// while the underlying traits are split by concern (core / character /
// world / ship). New code may import from a specific sub-file directly
// when it makes intent clearer.

export * from './core'
export * from './character'
export * from './world'
export * from './ship'
