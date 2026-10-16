// Types for the parts of privacy-check.mjs that vite.config.ts uses.
export function checkBundledModules(ids: string[], opts: { root: string; offline: boolean; expectAppCode?: boolean }): string[]
