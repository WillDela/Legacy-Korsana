import { useMemo } from 'react';
import { DAY_LABELS } from '../lib/dashboardConstants';
import { fmtDateISO, getTrainingPhase } from '../lib/dashboardHelpers';
import { computeReadinessFactors, computeWidgetData } from '../lib/dashboardCalculations';

// useDashboardMetrics owns every value Dashboard.jsx derives from
// activeGoal/activities/weekEntries/dashboardData for rendering — training
// phase, weekly volume, readiness, and the chart/table datasets. Pulled out
// of Dashboard.jsx because these useMemo blocks made up most of the
// component body; the page itself only orchestrates fetches, Strava sync,
// and the plan-workout modal.
export function useDashboardMetrics({ activeGoal, activities, weekEntries, dashboardData, unit, MPU }) {
  const today = new Date();
  const todayISO = useMemo(() => fmtDateISO(new Date()), []);

  const daysToRace = activeGoal?.race_date
    ? Math.max(0, Math.ceil((new Date(activeGoal.race_date) - today) / 86400000))
    : null;
  const weeksOut = daysToRace !== null ? Math.floor(daysToRace / 7) : null;
  const trainingPhase = weeksOut !== null ? getTrainingPhase(weeksOut) : 'Build';

  const trainingProgress = useMemo(() => {
    if (!activeGoal?.race_date) return 0;
    const raceDate = new Date(activeGoal.race_date);
    const created  = new Date(activeGoal.created_at || Date.now());
    const total    = raceDate - created;
    const elapsed  = today - created;
    if (total <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }, [activeGoal]);

  const totalTrainingWeeks = useMemo(() => {
    if (!activeGoal?.race_date || !activeGoal?.created_at) return null;
    return Math.ceil((new Date(activeGoal.race_date) - new Date(activeGoal.created_at)) / (7 * 86400000));
  }, [activeGoal]);

  const weeksIn = useMemo(() => {
    if (!activeGoal?.created_at) return null;
    return Math.max(1, Math.ceil((today - new Date(activeGoal.created_at)) / (7 * 86400000)));
  }, [activeGoal]);

  const heroSubtitle = useMemo(() => {
    if (!activeGoal) return 'Set a race goal to personalise your dashboard';
    const parts = [];
    if (weeksIn && totalTrainingWeeks) parts.push(`Week ${weeksIn} of ${totalTrainingWeeks}`);
    parts.push(`${trainingPhase} phase`);
    if (daysToRace != null) parts.push(`${daysToRace} day${daysToRace !== 1 ? 's' : ''} to race`);
    return parts.join(' · ');
  }, [activeGoal, weeksIn, totalTrainingWeeks, trainingPhase, daysToRace]);

  const priorityMetrics = useMemo(() => {
    const rec  = dashboardData?.recovery;
    const load = dashboardData?.training_load;
    const pred = dashboardData?.predictor;
    const recScore = rec?.score;
    const tsb = load?.tsb;
    return [
      {
        label: 'Recovery',
        value: recScore != null ? String(recScore) : '—',
        unit: '%',
        trend: recScore >= 70 ? 'up' : recScore >= 40 ? 'neutral' : 'down',
        variant: recScore >= 70 ? 'success' : recScore >= 40 ? 'warning' : 'danger',
        trendLabel: recScore >= 70 ? 'Good' : recScore >= 40 ? 'Fair' : 'Low',
      },
      {
        label: 'Form (TSB)',
        value: tsb != null ? `${tsb > 0 ? '+' : ''}${Math.round(tsb)}` : '—',
        trend: tsb > 5 ? 'up' : tsb < -5 ? 'down' : 'neutral',
        variant: tsb != null && Math.abs(tsb) <= 10 ? 'success' : 'neutral',
      },
      {
        label: 'Predictor',
        value: pred?.marathon_time || '—',
        trend: 'neutral',
        variant: 'neutral',
      },
    ];
  }, [dashboardData]);

  const startOfWeek = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const thisWeekRuns = useMemo(() =>
    activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= startOfWeek),
    [activities, startOfWeek]);

  const weeklyMileage = useMemo(() =>
    parseFloat((thisWeekRuns.reduce((s, a) => s + (a.distance_meters || 0), 0) / MPU).toFixed(1)),
    [thisWeekRuns, MPU]);

  const weeklyTarget = useMemo(() => {
    if (!activeGoal) return unit === 'imperial' ? 30 : 48;
    const raceDist   = (activeGoal.race_distance_meters || 42195) / MPU;
    const peakVolume = Math.min(raceDist * 3, unit === 'imperial' ? 60 : 96);
    const ramp = Math.min(1, trainingProgress / 80);
    return Math.round(Math.max(unit === 'imperial' ? 10 : 16, peakVolume * (0.5 + 0.5 * ramp)));
  }, [activeGoal, trainingProgress, unit, MPU]);

  const weeklyMilageDelta = useMemo(() => {
    if (!activities.length) return 0;
    const prevStart = new Date(startOfWeek);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevVol = activities
      .filter(a => a.activity_type === 'run' && new Date(a.start_time) >= prevStart && new Date(a.start_time) < startOfWeek)
      .reduce((s, a) => s + (a.distance_meters || 0), 0) / MPU;
    return parseFloat((weeklyMileage - prevVol).toFixed(1));
  }, [activities, weeklyMileage, startOfWeek, MPU]);

  const weeklyRunCount = thisWeekRuns.length;

  const trainingLoadScore = useMemo(() => {
    if (!weeklyTarget) return 0;
    return Math.min(100, Math.round((weeklyMileage / weeklyTarget) * 100));
  }, [weeklyMileage, weeklyTarget]);

  const trainingLoadLabel = useMemo(() => {
    if (trainingLoadScore < 30) return 'Light';
    if (trainingLoadScore < 60) return 'Moderate';
    if (trainingLoadScore < 85) return 'High';
    return 'Peak';
  }, [trainingLoadScore]);

  const aerobicEffData = useMemo(() => {
    const weeks = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const ws = new Date(d);
      ws.setDate(ws.getDate() - ws.getDay());
      ws.setHours(0, 0, 0, 0);
      const key = ws.toISOString().slice(0, 10);
      weeks[key] = { week: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), runs: [] };
    }
    activities
      .filter(a => a.activity_type === 'run' && a.average_pace_seconds_per_km && a.average_heart_rate)
      .forEach(a => {
        const d = new Date(a.start_time);
        const ws = new Date(d);
        ws.setDate(ws.getDate() - ws.getDay());
        const key = ws.toISOString().slice(0, 10);
        if (weeks[key]) weeks[key].runs.push({ pace: a.average_pace_seconds_per_km, hr: a.average_heart_rate });
      });
    return Object.values(weeks).map(w => ({
      week: w.week.replace(/\s+/, '\n'),
      eff: w.runs.length
        ? parseFloat((w.runs.reduce((s, r) => s + r.pace / r.hr, 0) / w.runs.length).toFixed(4))
        : null,
    }));
  }, [activities]);

  const aerobicEffImprovement = useMemo(() => {
    const withData = aerobicEffData.filter(w => w.eff !== null);
    if (withData.length < 2) return null;
    const oldest = withData[0].eff;
    const newest = withData[withData.length - 1].eff;
    const pctChange = ((oldest - newest) / oldest) * 100;
    return parseFloat(pctChange.toFixed(1));
  }, [aerobicEffData]);

  const consistency = useMemo(() => {
    if (!activities.length) return 0;
    let count = 0;
    for (let w = 0; w < 4; w++) {
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay() - w * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      if (activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= start && new Date(a.start_time) < end).length >= 3) count++;
    }
    return count * 25;
  }, [activities]);

  const targetPaceRaw = useMemo(() => {
    if (!activeGoal?.target_time_seconds || !activeGoal?.race_distance_meters) return null;
    return activeGoal.target_time_seconds / (activeGoal.race_distance_meters / 1000);
  }, [activeGoal]);

  const currentPaceRaw = useMemo(() => {
    const runs = activities.filter(a => a.activity_type === 'run' && a.average_pace_seconds_per_km);
    if (!runs.length) return null;
    return runs.reduce((s, a) => s + a.average_pace_seconds_per_km, 0) / runs.length;
  }, [activities]);

  const paceDiff = useMemo(() => {
    if (!currentPaceRaw || !targetPaceRaw) return null;
    return Math.round((currentPaceRaw - targetPaceRaw) * 1.60934);
  }, [currentPaceRaw, targetPaceRaw]);

  const readinessFactors = useMemo(() => computeReadinessFactors({
    weeklyMileage, weeklyTarget, paceDiff, consistency, activities, activeGoal, MPU, now: today,
  }), [weeklyMileage, weeklyTarget, paceDiff, consistency, activities, activeGoal]);

  const readinessScore = readinessFactors.composite;
  const readinessLabel = readinessScore >= 70 ? 'Race Ready' : readinessScore >= 50 ? 'On Track' : 'Building Base';
  const readinessColor = readinessScore >= 70 ? '#2ECC8B' : readinessScore >= 50 ? '#F5A623' : '#E84A4A';

  const weeklyChartData = useMemo(() => {
    const weeks = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const ws = new Date(d);
      ws.setDate(ws.getDate() - ws.getDay());
      const key = ws.toISOString().slice(0, 10);
      weeks[key] = {
        week: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(' ', '\n'),
        miles: 0,
      };
    }
    activities.filter(a => a.activity_type === 'run').forEach(a => {
      const d = new Date(a.start_time);
      const ws = new Date(d);
      ws.setDate(ws.getDate() - ws.getDay());
      const key = ws.toISOString().slice(0, 10);
      if (weeks[key]) weeks[key].miles += (a.distance_meters || 0) / MPU;
    });
    return Object.values(weeks).map(w => ({ ...w, miles: parseFloat(w.miles.toFixed(1)) }));
  }, [activities]);

  const effortDist = useMemo(() => {
    const zones = [
      { zone: 'Z1 Easy',    label: '< 130 bpm', color: '#5CC8FF', min: 0,   max: 130, mins: 0 },
      { zone: 'Z2 Aerobic', label: '130–148',   color: '#2ECC8B', min: 130, max: 148, mins: 0 },
      { zone: 'Z3 Tempo',   label: '148–162',   color: '#F5A623', min: 148, max: 162, mins: 0 },
      { zone: 'Z4 Hard',    label: '162–174',   color: '#E8634A', min: 162, max: 174, mins: 0 },
      { zone: 'Z5 Max',     label: '174+',      color: '#E84A4A', min: 174, max: 999, mins: 0 },
    ];
    const sevenAgo = new Date(today);
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const weekRuns = activities.filter(a => a.activity_type === 'run' && a.average_heart_rate && new Date(a.start_time) >= sevenAgo);
    weekRuns.forEach(a => {
      const durationMins = (a.duration_seconds || a.moving_time_seconds || 0) / 60;
      const hr = a.average_heart_rate;
      const zone = zones.find(z => hr >= z.min && hr < z.max);
      if (zone) zone.mins += durationMins;
    });
    const total = zones.reduce((s, z) => s + z.mins, 0) || 1;
    return zones.map(z => ({ ...z, pct: Math.round((z.mins / total) * 100) }));
  }, [activities]);

  const todayEntries = useMemo(() =>
    weekEntries.filter(e => e.date === todayISO),
    [weekEntries, todayISO]);

  const calendarStrip = useMemo(() => {
    const result = [];
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay();
    const monday = new Date(todayMidnight);
    monday.setDate(todayMidnight.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = fmtDateISO(d);
      const calEntries = weekEntries.filter(e => e.date === iso);
      const entry = calEntries[0] || null;
      const isToday = iso === todayISO;
      const type  = entry?.workout_type || null;
      const title = entry?.title || null;
      const miles = entry?.planned_distance_meters
        ? parseFloat((entry.planned_distance_meters / MPU).toFixed(1))
        : null;
      result.push({
        day: DAY_LABELS[d.getDay()], date: String(d.getDate()), iso,
        type, title, miles,
        done: entry?.status === 'completed',
        today: isToday, count: calEntries.length,
      });
    }
    return result;
  }, [weekEntries, todayISO]);

  const upNextEntries = useMemo(() =>
    calendarStrip.filter(d => !d.today && !d.done && d.type && d.type !== 'Rest').slice(0, 3),
    [calendarStrip]);

  const recentRuns = useMemo(() =>
    activities
      .filter(a => a.activity_type === 'run')
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
      .slice(0, 6),
    [activities]);

  const widgetData = useMemo(() => computeWidgetData({
    activities, weeklyTarget, startOfWeek, now: today,
  }), [activities, weeklyTarget, startOfWeek]);

  return {
    todayISO,
    trainingPhase,
    heroSubtitle,
    priorityMetrics,
    weeklyMileage,
    weeklyTarget,
    weeklyMilageDelta,
    weeklyRunCount,
    trainingLoadScore,
    trainingLoadLabel,
    aerobicEffData,
    aerobicEffImprovement,
    readinessFactors,
    readinessScore,
    readinessLabel,
    readinessColor,
    weeklyChartData,
    effortDist,
    todayEntries,
    calendarStrip,
    upNextEntries,
    recentRuns,
    widgetData,
  };
}
