export const fmtDateISO = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export const fmtTime = (secs) => {
  if (!secs) return '--:--:--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const getTrainingPhase = (weeksOut) => {
  if (weeksOut < 2) return 'Race Week';
  if (weeksOut < 8) return 'Taper';
  if (weeksOut < 12) return 'Peak';
  return 'Build';
};

export const getWorkoutSegments = (type, dist, u) => {
  const m = dist || 0;
  const ul = u === 'imperial' ? 'mi' : 'km';
  switch (type) {
    case 'Long Run':
    case 'Long':
      return [
        { name: 'Warm-up',  detail: `2 ${ul} easy · HR ramp to Z2` },
        { name: 'Main Set', detail: `${Math.max(1, m - 4)} ${ul} @ Z2 · feel conversational` },
        { name: 'Cool-down', detail: `2 ${ul} easy walk/jog` },
      ];
    case 'Tempo':
      return [
        { name: 'Warm-up',  detail: `1 ${ul} easy` },
        { name: 'Main Set', detail: `${Math.max(1, m - 2)} ${ul} @ Z3–Z4 · comfortably hard` },
        { name: 'Cool-down', detail: `1 ${ul} easy` },
      ];
    case 'Intervals':
      return [
        { name: 'Warm-up',  detail: `1 ${ul} easy + strides` },
        { name: 'Main Set', detail: 'Repeats @ Z4–Z5 · full recovery' },
        { name: 'Cool-down', detail: `1 ${ul} easy jog` },
      ];
    default:
      return [
        { name: 'Effort',   detail: 'Z1–Z2 · conversational pace' },
        { name: 'Duration', detail: `${m > 0 ? `${m} ${ul} target` : 'Easy effort'}` },
        { name: 'Focus',    detail: 'Keep HR below Z3' },
      ];
  }
};
