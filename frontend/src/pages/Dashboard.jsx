import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { goalsAPI } from '../api/goals';
import { useUnits } from '../context/UnitsContext';
import { formatPace, distanceLabel } from '../utils/units';
import { stravaAPI } from '../api/strava';
import { activitiesAPI } from '../api/activities';
import { calendarAPI } from '../api/calendar';
import { userProfileAPI } from '../api/userProfile';
import { getErrorMessage } from '../api/client';
import SessionDetailsModal from '../components/SessionDetailsModal';
import { dashboardAPI } from '../api/dashboard';
import AppPageHero from '../components/ui/AppPageHero';
import MetricStrip from '../components/ui/MetricStrip';
import BriefingPanel from '../components/ui/BriefingPanel';
import { coachAPI } from '../api/coach';
import { getStravaRedirectState, clearStravaRedirectParams } from '../lib/stravaRedirect';
import { useStravaSync } from '../hooks/useStravaSync';
import { PHASE_VARIANT, DAY_LABELS } from '../lib/dashboardConstants';
import { fmtDateISO, getTrainingPhase } from '../lib/dashboardHelpers';
import WidgetSelector from '../components/dashboard/WidgetSelector';
import WidgetGrid from '../components/dashboard/WidgetGrid';
import WeekCalendarStrip from '../components/dashboard/sections/WeekCalendarStrip';
import TodayWorkoutCard from '../components/dashboard/sections/TodayWorkoutCard';
import RaceReadinessCard from '../components/dashboard/sections/RaceReadinessCard';
import UpNextCard from '../components/dashboard/sections/UpNextCard';
import MetricCardsRow from '../components/dashboard/sections/MetricCardsRow';
import TrainingTrendsCharts from '../components/dashboard/sections/TrainingTrendsCharts';
import RecentRunsTable from '../components/dashboard/sections/RecentRunsTable';

// ─── Dashboard ────────────────────────────────────────────────
const Dashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { unit } = useUnits();

  // Unit-aware helpers (defined here so they close over `unit`)
  const MPU = unit === 'imperial' ? 1609.34 : 1000;            // meters per unit
  const fmtPace = (secPerKm) => formatPace(secPerKm, unit);
  const unitLabel = distanceLabel(unit);

  const [activeGoal, setActiveGoal] = useState(null);
  const [activities, setActivities] = useState([]);
  const [weekEntries, setWeekEntries] = useState([]);
  const [stravaConnected, setStravaConnected] = useState(null);
  const [insight, setInsight] = useState(null);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [activeWidgets, setActiveWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard_widgets');
      return saved ? JSON.parse(saved) : ['load', 'predictor', 'longrun', 'recovery', 'hrzones', 'crosstraining'];
    } catch { return ['load', 'predictor', 'longrun', 'recovery', 'hrzones', 'crosstraining']; }
  });
  useEffect(() => {
    localStorage.setItem('dashboard_widgets', JSON.stringify(activeWidgets));
  }, [activeWidgets]);
  const toggleWidget = useCallback((id) => setActiveWidgets(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  ), []);

  const [dashboardData, setDashboardData] = useState(null);

  const fetchActiveGoal = useCallback(async () => {
    try {
      const res = await goalsAPI.getActiveGoal();
      setActiveGoal(res.goal);
    } catch { /* no active goal */ }
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await activitiesAPI.getActivities();
      const acts = res.activities || [];
      setActivities(acts);
      return acts;
    } catch {
      setActivities([]);
      return [];
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      const data = await dashboardAPI.get();
      setDashboardData(data);
    } catch { /* dashboard data unavailable */ }
  }, []);

  const fetchInsight = useCallback(async () => {
    const CACHE_KEY = 'korsana_insight';
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const today = new Date().toDateString();
      if (cached?.date === today && cached?.text) {
        setInsight(cached.text);
        return;
      }
    } catch { /* ignore bad cache */ }

    try {
      const data = await coachAPI.getInsight();
      const text = data?.insight || null;
      setInsight(text);
      if (text) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ text, date: new Date().toDateString() }));
      }
    } catch { /* insight is non-critical, fail silently */ }
  }, []);

  const fetchWeekEntries = useCallback(async () => {
    try {
      const today = new Date();
      const monday = new Date(today);
      const day = today.getDay();
      monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
      monday.setHours(0, 0, 0, 0);
      const res = await calendarAPI.getWeek(fmtDateISO(monday));
      const entries = (res.entries || []).map(e => ({ ...e, date: e.date.slice(0, 10) }));
      setWeekEntries(entries);
    } catch { setWeekEntries([]); }
  }, []);

  const handlePlanWorkout = () => setShowPlanModal(true);

  const handleSavePlan = useCallback(async (data) => {
    await calendarAPI.createEntry(data);
    fetchWeekEntries();
  }, [fetchWeekEntries]);

  const handleMarkDone = useCallback(async (entryId) => {
    await calendarAPI.updateStatus(entryId, 'completed');
    fetchWeekEntries();
  }, [fetchWeekEntries]);


  const { syncing: isSyncing, syncMessage: syncMsg, sync: syncStravaActivities, showMessage: showSyncMessage } =
    useStravaSync({
      onSuccess: async () => {
        setStravaConnected(true);
        await Promise.all([fetchActivities(), fetchDashboardData()]);
      },
      onNotConnected: () => setStravaConnected(false),
    });

  const handleConnectStrava = useCallback(async () => {
    try {
      const data = await stravaAPI.getAuthURL('/dashboard');
      window.location.href = data.url;
    } catch {
      showSyncMessage('Could not start Strava connect. Try again from Settings.', 'error', 4000);
    }
  }, [showSyncMessage]);

  const handleSyncActivities = useCallback(async (provider = 'strava') => {
    if (provider !== 'strava') {
      const name = provider[0].toUpperCase() + provider.slice(1);
      try {
        await userProfileAPI.requestIntegrationInterest(provider);
        showSyncMessage(`We'll keep you posted when ${name} beta access opens.`, 'success', 3500);
      } catch (error) {
        showSyncMessage(getErrorMessage(error), 'error', 4000);
      }
      return;
    }

    await syncStravaActivities();
  }, [showSyncMessage, syncStravaActivities]);

  useEffect(() => {
    const redirectState = getStravaRedirectState(searchParams);
    if (!redirectState) return;

    clearStravaRedirectParams(setSearchParams);

    if (redirectState.type === 'success') {
      showSyncMessage('Strava connected. Pulling in your latest activities...', 'success', 4500);
      syncStravaActivities({ afterConnect: true });
      return;
    }

    showSyncMessage(redirectState.text, 'error', 5000);
  }, [searchParams, setSearchParams, showSyncMessage, syncStravaActivities]);

  useEffect(() => {
    fetchActiveGoal();
    (async () => {
      const acts = await fetchActivities();
      if (!acts.length) syncStravaActivities();
    })();
    fetchWeekEntries();
    fetchDashboardData();
    fetchInsight();
  }, []);

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

  const readinessFactors = useMemo(() => {
    const volumeScore = Math.min(100, (weeklyMileage / weeklyTarget) * 100);
    let paceScore = 50;
    if (paceDiff !== null) {
      paceScore = Math.abs(paceDiff) <= 5 ? 100 : Math.abs(paceDiff) <= 15 ? 75 : Math.abs(paceDiff) <= 30 ? 50 : 25;
    }
    const longRunScore = (() => {
      if (!activeGoal || !activities.length) return 50;
      const twa = new Date(today);
      twa.setDate(twa.getDate() - 21);
      const longest = Math.max(0, ...activities.filter(a => a.activity_type === 'run' && new Date(a.start_time) >= twa).map(a => a.distance_meters || 0));
      const target = (activeGoal.race_distance_meters || 42195) * 0.6;
      return target > 0 ? Math.min(100, (longest / target) * 100) : 50;
    })();
    let trendScore = 50;
    if (activities.length) {
      const prev = [];
      for (let w = 1; w <= 3; w++) {
        const start = new Date(today);
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
    const sevenAgo = new Date(today);
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
  }, [weeklyMileage, weeklyTarget, paceDiff, consistency, activities, activeGoal]);

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

  const widgetData = useMemo(() => {
    const elevWeeks = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
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
      const start = new Date(today);
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
  }, [activities, effortDist, weeklyTarget, startOfWeek]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div>
      <style>{`
        button{cursor:pointer;transition:opacity 0.15s}
        @keyframes krs-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .krs-rr:hover { background: var(--color-bg-elevated) !important; cursor: pointer }
        .krs-cal:hover { background: var(--color-bg-elevated) !important }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #D4D8E8; border-radius: 3px; }
      `}</style>

      {/* ── PAGE HERO ── */}
      <AppPageHero
        title={activeGoal?.race_name || 'Your Training'}
        subtitle={heroSubtitle}
        status={activeGoal ? { label: `${trainingPhase} Phase`, variant: PHASE_VARIANT[trainingPhase] || 'info' } : null}
        size="lg"
        primaryAction={{
          label: isSyncing ? 'Syncing…' : (stravaConnected === false ? 'Connect Strava' : 'Sync Strava'),
          onClick: stravaConnected === false ? handleConnectStrava : handleSyncActivities,
          disabled: isSyncing,
        }}
      >
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <button
            onClick={handlePlanWorkout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-navy border border-[var(--color-border)] bg-white hover:bg-[var(--color-bg-elevated)] transition-all cursor-pointer"
          >
            + Plan Activity
          </button>
          <WidgetSelector active={activeWidgets} toggle={toggleWidget} />
          {syncMsg.text && (
            <span
              className="font-sans text-[11px] font-semibold"
              style={{ color: syncMsg.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)' }}
            >
              {syncMsg.text}
            </span>
          )}
        </div>
      </AppPageHero>

      {/* ── PRIORITY STRIP ── */}
      <div className="mb-6">
        <MetricStrip metrics={priorityMetrics} />
      </div>

      {/* ── COACH BRIEFING ── */}
      {insight && (
        <div className="mb-6">
          <BriefingPanel
            reason={insight}
            action={{ label: 'Talk to Coach', href: '/coach' }}
            variant="insight"
          />
        </div>
      )}

      {/* ── BODY ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* ① WEEK CALENDAR STRIP */}
              <WeekCalendarStrip calendarStrip={calendarStrip} unitLabel={unitLabel} />

              {/* ② TODAY'S WORKOUT */}
              <TodayWorkoutCard
                todayEntries={todayEntries}
                unit={unit}
                unitLabel={unitLabel}
                MPU={MPU}
                onMarkDone={handleMarkDone}
                onPlanWorkout={handlePlanWorkout}
              />

              {/* Race Readiness */}
              <RaceReadinessCard
                score={readinessScore}
                label={readinessLabel}
                color={readinessColor}
                factors={readinessFactors}
              />

              {/* Up Next */}
              <UpNextCard entries={upNextEntries} unitLabel={unitLabel} />

              {/* ③ METRIC CARDS */}
              <MetricCardsRow
                weeklyMileage={weeklyMileage}
                weeklyTarget={weeklyTarget}
                unitLabel={unitLabel}
                weeklyMilageDelta={weeklyMilageDelta}
                aerobicEffImprovement={aerobicEffImprovement}
                aerobicEffData={aerobicEffData}
                trainingLoadScore={trainingLoadScore}
                trainingLoadLabel={trainingLoadLabel}
                weeklyRunCount={weeklyRunCount}
              />

              {/* ④ TRAINING TRENDS */}
              <TrainingTrendsCharts weeklyChartData={weeklyChartData} unitLabel={unitLabel} effortDist={effortDist} />

              {/* ⑤ RECENT RUNS */}
              <RecentRunsTable recentRuns={recentRuns} MPU={MPU} unitLabel={unitLabel} fmtPace={fmtPace} />

              {/* ⑥ OPTIONAL WIDGET GRID */}
              <WidgetGrid active={activeWidgets} dashboardData={dashboardData} computedData={widgetData} onRefresh={fetchDashboardData} stravaConnected={stravaConnected} onConnect={handleConnectStrava} />
      </div>

      <SessionDetailsModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        onSave={handleSavePlan}
        onDelete={() => {}}
        entry={null}
        selectedDate={todayISO}
      />
    </div>
  );
};

export default Dashboard;
