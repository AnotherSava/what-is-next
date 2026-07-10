// Small presentation helpers shared across pages.

// Render a count with its noun, pluralized. Pass an explicit plural form for irregular nouns (e.g.
// plural(n, "watch", "watches")); regular nouns default to singular + "s".
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
