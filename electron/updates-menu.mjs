export function familyNameOf(entry) {
  return entry.customFamilyName || entry.faces?.[0]?.familyName || 'Unknown'
}

export function outdatedFamilies(entries) {
  const map = new Map()
  for (const entry of entries) {
    if (entry.status !== 'outdated') continue
    const name = familyNameOf(entry)
    const ids = map.get(name) ?? []
    ids.push(entry.id)
    map.set(name, ids)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ids]) => ({ name, ids }))
}

export function menuBarUpdateBadge(count) {
  if (count <= 0) return ''
  if (count > 99) return '99+'
  return String(count)
}
