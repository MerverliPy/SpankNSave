export class OrderedMap<K, V> {
  readonly #map = new Map<K, V>()

  get size(): number {
    return this.#map.size
  }

  set(key: K, value: V): this {
    this.#map.delete(key)
    this.#map.set(key, value)
    return this
  }

  get(key: K): V | undefined {
    return this.#map.get(key)
  }

  delete(key: K): boolean {
    return this.#map.delete(key)
  }

  has(key: K): boolean {
    return this.#map.has(key)
  }

  clear(): void {
    this.#map.clear()
  }

  moveToEnd(key: K): void {
    const value = this.#map.get(key)
    if (value === undefined) return
    this.#map.delete(key)
    this.#map.set(key, value)
  }

  keys(): IterableIterator<K> {
    return this.#map.keys()
  }

  oldestKey(): K | undefined {
    const first = this.#map.keys().next()
    return first.done ? undefined : first.value
  }
}
