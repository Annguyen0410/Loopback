/**
 * Minimal string-aware JSONC comment stripper.
 * Safe for strings containing "//" (e.g. URLs) and escape sequences.
 */
export function stripJsoncComments(text: string): string {
  let result = ''
  let inString = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      result += ch
      if (ch === '\\' && i + 1 < text.length) {
        result += text[i + 1]
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    result += ch
    i++
  }
  return result
}
