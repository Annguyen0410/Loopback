/**
 * Event-density grid for the map.
 *
 * A "heat" view over the normalized event store: events that carry real
 * coordinates are grouped into coarse lat/lng cells and drawn as one circle per
 * cell. It is a count of cached records, not a risk score, and each popup says
 * so. Events without coordinates are left out rather than guessed onto the map.
 */

export function clusterEvents(events, { from = 0, cellSize = 6, max = 60 } = {}) {
  const size = Math.max(1, Math.min(30, Number(cellSize) || 6));
  const groups = new Map();

  for (const event of events || []) {
    if (!event || event.lat == null || event.lng == null) continue;
    const lat = Number(event.lat);
    const lng = Number(event.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const stamp = event.eventTime || event.observedAt || 0;
    if (stamp < from) continue;

    const row = Math.floor((lat + 90) / size);
    const col = Math.floor((lng + 180) / size);
    const key = row + ":" + col;
    let group = groups.get(key);
    if (!group) {
      group = {
        key, lat: 0, lng: 0, count: 0,
        crit: 0, warn: 0, info: 0, latest: 0, categories: new Map()
      };
      groups.set(key, group);
    }

    group.lat += lat;
    group.lng += lng;
    group.count++;
    const sev = event.severity === "crit" ? "crit" : event.severity === "warn" ? "warn" : "info";
    group[sev]++;
    group.latest = Math.max(group.latest, stamp);
    const category = event.category || "EVENT";
    group.categories.set(category, (group.categories.get(category) || 0) + 1);
  }

  return [...groups.values()]
    .map(group => ({
      key: group.key,
      lat: group.lat / group.count,
      lng: group.lng / group.count,
      count: group.count,
      crit: group.crit,
      warn: group.warn,
      info: group.info,
      latest: group.latest,
      categories: [...group.categories.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, count }))
    }))
    .sort((a, b) => b.crit - a.crit || b.count - a.count)
    .slice(0, Math.max(1, max));
}
