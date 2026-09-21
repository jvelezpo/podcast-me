import AsyncStorage from '@react-native-async-storage/async-storage'

export type CollectionOrderEntry = {
  kind: 'local' | 'remote'
  id: string
}

const STORAGE_KEY_PREFIX = 'podcast-me.collection-order.v1'

export async function loadCollectionOrder(
  scopeId: string,
): Promise<CollectionOrderEntry[]> {
  try {
    const storedOrder = await AsyncStorage.getItem(storageKey(scopeId))

    if (storedOrder === null) {
      return []
    }

    const parsedOrder: unknown = JSON.parse(storedOrder)

    if (!Array.isArray(parsedOrder)) {
      return []
    }

    return uniqueEntries(parsedOrder)
  } catch {
    return []
  }
}

export async function saveCollectionOrder(
  scopeId: string,
  entries: readonly CollectionOrderEntry[],
): Promise<void> {
  await AsyncStorage.setItem(
    storageKey(scopeId),
    JSON.stringify(uniqueEntries(entries)),
  )
}

function storageKey(scopeId: string): string {
  return `${STORAGE_KEY_PREFIX}.${scopeId}`
}

function uniqueEntries(values: readonly unknown[]): CollectionOrderEntry[] {
  const entries = new Map<string, CollectionOrderEntry>()

  for (const value of values) {
    if (!isCollectionOrderEntry(value)) {
      continue
    }

    entries.set(entryKey(value), value)
  }

  return [...entries.values()]
}

function isCollectionOrderEntry(value: unknown): value is CollectionOrderEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'id' in value &&
    (value.kind === 'local' || value.kind === 'remote') &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0
  )
}

function entryKey(entry: CollectionOrderEntry): string {
  return `${entry.kind}:${entry.id}`
}
