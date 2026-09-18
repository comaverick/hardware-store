// Choose a small set of coherent photographs across a supported surface.
// Work by physical area, not triangle count: clipping a duplicate sheet can
// create many tiny faces without making their photo any more representative.
export function selectSurfaceTextures(records) {
  const patches = new Map();
  for (const record of records) {
    if (record.patch < 0 || !record.candidates.length) continue;
    if (!patches.has(record.patch)) patches.set(record.patch, []);
    patches.get(record.patch).push(record);
  }
  let rejectedSoftCandidates = 0;
  for (const members of patches.values()) {
    const comparisons = new Map();
    for (const record of members) for (const first of record.candidates) for (const second of record.candidates) {
      if (first === second) continue;
      const key = `${first.frame.textureId}:${second.frame.textureId}`;
      const vote = comparisons.get(key) || {
        shared: 0,
        clearer: 0
      };
      vote.shared += record.area;
      if (second.localFocus >= 4 && second.localFocus > first.localFocus * 1.8 && second.localFocus - first.localFocus > 2.5 && second.localDetail >= first.localDetail * 0.8 && second.pixelDensity >= first.pixelDensity * 0.8) vote.clearer += record.area;
      comparisons.set(key, vote);
    }
    const eligible = new Map();
    for (const record of members) {
      const candidates = record.candidates.filter(first => !record.candidates.some(second => {
        if (first === second) return false;
        const vote = comparisons.get(`${first.frame.textureId}:${second.frame.textureId}`);
        // Repeated evidence of blur wins. One displaced edge or reflection is
        // not enough to alternate cameras on every other triangle.
        return vote?.shared > 0 && vote.clearer / vote.shared >= 0.8;
      }));
      eligible.set(record, candidates.length ? candidates : record.candidates);
      rejectedSoftCandidates += record.candidates.length - candidates.length;
    }
    let remaining = members;
    while (remaining.length) {
      const scores = new Map();
      for (const record of remaining) for (const candidate of eligible.get(record)) {
        if (candidate.score < record.candidates[0].score - 3) continue;
        const id = candidate.frame.textureId;
        scores.set(id, (scores.get(id) || 0) + record.area * Math.exp((candidate.score - record.candidates[0].score) * 0.3));
      }
      const preferred = [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (preferred === undefined) break;
      remaining = remaining.filter(record => {
        const candidate = eligible.get(record).find(value => value.frame.textureId === preferred && value.score >= record.candidates[0].score - 3);
        if (!candidate) return true;
        record.selected = record.candidates.indexOf(candidate);
        return false;
      });
    }
  }
  return {
    mode: "surface-area-coverage",
    patches: patches.size,
    rejectedSoftCandidates
  };
}
