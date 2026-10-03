/**
 * Splits `totalMinor` by integer weights using the largest-remainder method: everyone gets the
 * floor of their exact share, and the leftover paise go to the people whose exact share had the
 * largest fractional part (ties go to whoever comes first in the list). All arithmetic is on
 * integers, so the parts always add up to the total.
 */
export function allocateByWeights(totalMinor: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => {
    const product = totalMinor * weight;
    return { floor: Math.floor(product / weightSum), remainder: product % weightSum };
  });
  const amounts = exact.map((entry) => entry.floor);

  let leftover = totalMinor - amounts.reduce((sum, amount) => sum + amount, 0);
  const order = exact
    .map((entry, index) => ({ index, remainder: entry.remainder }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    amounts[index] = (amounts[index] ?? 0) + 1;
    leftover -= 1;
  }
  return amounts;
}
