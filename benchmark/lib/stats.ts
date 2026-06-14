export const mean = (values: number[]): number =>
  values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length

export const quantile = (values: number[], probability: number): number => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const p = Math.min(1, Math.max(0, probability))
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]!
  const weight = position - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

export const median = (values: number[]): number => quantile(values, 0.5)

export const sampleStandardDeviation = (values: number[]): number => {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

export const wilson95 = (successes: number, total: number): [number, number] => {
  if (total <= 0) return [Number.NaN, Number.NaN]
  const z = 1.959963984540054
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = (p + (z * z) / (2 * total)) / denominator
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}

export const percentage = (value: number, digits = 1): string =>
  Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "n/a"

export const fixed = (value: number, digits = 3): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a"

export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export const bootstrapMedianDifference95 = (
  pairs: Array<{ baseline: number; treatment: number }>,
  iterations = 10_000,
  seed = 0x5a17,
): [number, number] => {
  if (pairs.length === 0) return [Number.NaN, Number.NaN]
  const random = seededRandom(seed)
  const samples: number[] = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const differences: number[] = []
    for (let index = 0; index < pairs.length; index += 1) {
      const sampled = pairs[Math.floor(random() * pairs.length)]!
      differences.push(sampled.treatment - sampled.baseline)
    }
    samples.push(median(differences))
  }
  return [quantile(samples, 0.025), quantile(samples, 0.975)]
}

export const bootstrapMedian95 = (
  values: number[],
  iterations = 10_000,
  seed = 0x45f3,
): [number, number] => {
  if (values.length === 0) return [Number.NaN, Number.NaN]
  const random = seededRandom(seed)
  const samples: number[] = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)]!,
    )
    samples.push(median(sample))
  }
  return [quantile(samples, 0.025), quantile(samples, 0.975)]
}

export const pearsonCorrelation = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length < 2) return Number.NaN
  const leftMean = mean(left)
  const rightMean = mean(right)
  let numerator = 0
  let leftSum = 0
  let rightSum = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDifference = left[index]! - leftMean
    const rightDifference = right[index]! - rightMean
    numerator += leftDifference * rightDifference
    leftSum += leftDifference ** 2
    rightSum += rightDifference ** 2
  }
  const denominator = Math.sqrt(leftSum * rightSum)
  return denominator === 0 ? Number.NaN : numerator / denominator
}

const binomialCoefficient = (n: number, k: number): number => {
  const effectiveK = Math.min(k, n - k)
  let result = 1
  for (let index = 1; index <= effectiveK; index += 1) {
    result = (result * (n - effectiveK + index)) / index
  }
  return result
}

export const exactTwoSidedBinomialPValue = (successes: number, trials: number): number => {
  if (trials <= 0) return 1
  const observedProbability = binomialCoefficient(trials, successes) * 0.5 ** trials
  let pValue = 0
  for (let count = 0; count <= trials; count += 1) {
    const probability = binomialCoefficient(trials, count) * 0.5 ** trials
    if (probability <= observedProbability + Number.EPSILON) pValue += probability
  }
  return Math.min(1, pValue)
}
