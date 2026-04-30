export function didYouMean(value: string, candidates: string[]): string | null {
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = levenshtein(value, candidate);
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  return best && best.distance <= Math.max(3, Math.floor(value.length / 3)) ? best.candidate : null;
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}
