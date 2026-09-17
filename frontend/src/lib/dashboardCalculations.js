// Pure calculation functions extracted from Dashboard.jsx's heaviest useMemo
// bodies, so they can be unit tested without rendering the page. Each takes
// its inputs as explicit parameters instead of closing over component state.

export const computeReadinessFactors = ({
  weeklyMileage,
  weeklyTarget,
  paceDiff,
  consistency,
  activities,
  activeGoal,
  MPU,
  now = new Date(),
}) => {
  const volumeScore = Math.min(100, (weeklyMileage / weeklyTarget) * 100);
  let paceScore = 50;
  if (paceDiff !== null) {
    paceScore = Math.abs(paceDiff) <= 5 ? 100 : Math.abs(paceDiff) <= 15 ? 75 : Math.abs(paceDiff) <= 30 ? 50 : 25;
  }
  const longRunScore = (() => {
    if (!activeGoal || !activities.length) return 50;
    const twa = new Date(now);
    twa.setDate(twa.getDate() - 21);
    const longest = Math.max(0, ...activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= twa).map(a => a.distance_meters || 0));
    const target = (activeGoal.race_distance_meters || 42195) * 0.6;
    return target > 0 ? Math.min(100, (longest / target) * 100) : 50;
  })();
  let trendScore = 50;
  if (activities.length) {
    const prev = [];
    for (let w = 1; w <= 3; w++) {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay() - w * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      prev.push(activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= start && new Date(a.start_time) < end).reduce((s, a) => s + (a.distance_meters || 0) / MPU, 0));
    }
    const avg = prev.reduce((a, b) => a + b, 0) / 3;
    if (avg > 0) {
      const ratio = weeklyMileage / avg;
      trendScore = ratio >= 1.1 ? 100 : ratio >= 0.9 ? 75 : ratio >= 0.7 ? 50 : 25;
    }
  }
  const sevenAgo = new Date(now);
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const crossDays = new Set(activities.filter(a => a.activity_type !== 'run' && new Date(a.start_time) >= sevenAgo).map(a => new Date(a.start_time).toISOString().slice(0, 10))).size;
  const crossScore = Math.min(100, crossDays * 34);
  const composite = Math.round(volumeScore * 0.22 + paceScore * 0.22 + consistency * 0.18 + longRunScore * 0.15 + trendScore * 0.13 + crossScore * 0.10);
  return {
    Volume: Math.round(volumeScore),
    'Aerobic Base': Math.round(paceScore),
    Consistency: Math.round(consistency),
    'Long Run': Math.round(longRunScore),
    Trend: Math.round(trendScore),
    composite: Math.min(100, Math.max(0, composite)),
  };
};

export const computeWidgetData = ({ activities, weeklyTarget, startOfWeek, now = new Date() }) => {
  const elevWeeks = {};
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const ws = new Date(d);
    ws.setDate(ws.getDate() - ws.getDay());
    const key = ws.toISOString().slice(0, 10);
    elevWeeks[key] = {
      week: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(' ', ''),
      ft: 0,
    };
  }
  let weeklyElevGain = 0, weeklyElevLoss = 0;
  activities.filter(a => a.activity_type === 'run').forEach(a => {
    const ft = Math.round((a.elevation_gain || 0) * 3.28084);
    const d = new Date(a.start_time);
    const ws = new Date(d);
    ws.setDate(ws.getDate() - ws.getDay());
    const key = ws.toISOString().slice(0, 10);
    if (elevWeeks[key]) elevWeeks[key].ft += ft;
    if (new Date(a.start_time) >= startOfWeek) {
      weeklyElevGain += ft;
      weeklyElevLoss += Math.round((a.elevation_loss || a.elevation_gain || 0) * 3.28084);
    }
  });

  const cadenceRuns = activities.filter(a => a.activity_type === 'run' && (a.average_cadence || a.cadence));
  const avgCadence  = cadenceRuns.length
    ? Math.round(cadenceRuns.reduce((s, a) => s + (a.average_cadence || a.cadence || 0), 0) / cadenceRuns.length)
    : 0;
  const cadWeeks = Object.values(elevWeeks).map((w, i) => ({ week: w.week, spm: avgCadence > 0 ? avgCadence + (i - 4) : 170 + (i - 4) }));

  const calWeeks = Object.entries(elevWeeks).map(([key, w]) => {
    const ws = new Date(key);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 7);
    const kcal = Math.round(activities
      .filter(a => new Date(a.start_time) >= ws && new Date(a.start_time) < we)
      .reduce((s, a) => s + (a.calories || 0), 0));
    return { week: w.week, kcal };
  });
  const weekCals = calWeeks[calWeeks.length - 1]?.kcal || 0;

  const allWeeks = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay() - w * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const runs = activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= start && new Date(a.start_time) < end).length;
    allWeeks.push({ week: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(' ', ''), runs });
  }
  let streak = 0, longest = 0, cur = 0;
  for (const w of allWeeks) {
    if (w.runs >= 3) { cur++; streak = cur; longest = Math.max(longest, cur); }
    else cur = 0;
  }

  const weekRunCount = activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= startOfWeek).length;
  const lastRunWithElev = activities
    .filter(a => a.activity_type === 'run' && (a.elevation_gain || a.elevation_gain_meters))
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))[0];
  const lastRunGainFt = lastRunWithElev
    ? Math.round((lastRunWithElev.elevation_gain || lastRunWithElev.elevation_gain_meters || 0) * 3.28084)
    : 0;

  return {
    elevation: {
      weekly_gain_ft: weeklyElevGain || 0,
      weekly_loss_ft: weeklyElevLoss || 0,
      last_run_gain_ft: lastRunGainFt,
      trend: Object.values(elevWeeks).map(w => ({ week: w.week, ft: w.ft })),
    },
    cadence: {
      avg_spm: avgCadence || 174, goal_spm: 180,
      trend: cadWeeks.map(w => ({ week: w.week, spm: w.spm })),
      by_activity: [
        { type: 'Easy',      spm: avgCadence || 170 },
        { type: 'Tempo',     spm: (avgCadence || 170) + 6 },
        { type: 'Long',      spm: avgCadence || 172 },
        { type: 'Intervals', spm: (avgCadence || 170) + 10 },
      ],
    },
    calories: {
      weekly_burn: weekCals || 0,
      weekly_target: weeklyTarget * 120,
      per_run_avg: weekRunCount > 0 ? Math.round((weekCals || 0) / weekRunCount) : 0,
      trend: calWeeks.slice(-8).map(w => ({ week: w.week, kcal: w.kcal })),
    },
    streak: {
      current_streak: streak, longest_streak: longest,
      weekly_target: 3,
      weeks: allWeeks.slice(-8).map(w => ({ week: w.week, runs: w.runs, hit: w.runs >= 3 })),
    },
  };
};
