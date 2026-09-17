import { useState, useEffect, useMemo, useCallback } from 'react';
import { LuCheck } from 'react-icons/lu';
import { useSearchParams, Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
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
import { chartTheme } from '../lib/chartTheme';
import { getStravaRedirectState, clearStravaRedirectParams } from '../lib/stravaRedirect';
import { useStravaSync } from '../hooks/useStravaSync';
import { WC, PHASE_VARIANT, DAY_LABELS, RUN_TABLE_COLS, RUN_TABLE_HEADERS } from '../lib/dashboardConstants';
import { fmtDateISO, fmtTime, getTrainingPhase, getWorkoutSegments } from '../lib/dashboardHelpers';
import Pill from '../components/dashboard/atoms/Pill';
import Card from '../components/dashboard/atoms/Card';
import SLabel from '../components/dashboard/atoms/SLabel';
import Tip from '../components/dashboard/atoms/Tip';
import Gauge from '../components/dashboard/atoms/Gauge';
import WidgetSelector from '../components/dashboard/WidgetSelector';
import WidgetGrid from '../components/dashboard/WidgetGrid';

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

  const [showFactors, setShowFactors] = useState(false);
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
              <div>
                <SLabel action={
                  <Link to="/calendar" className="font-sans text-[12px] font-semibold text-coral no-underline cursor-pointer">
                    Full Calendar →
                  </Link>
                }>This Week's Plan</SLabel>
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="grid grid-cols-7">
                    {calendarStrip.map((d, i) => {
                      const s = WC[d.type] || WC.Easy;
                      const isT = d.today;
                      return (
                        <div
                          key={i}
                          className={`py-[18px] px-2 pb-4 text-center relative cursor-default transition-colors ${i < 6 ? 'border-r border-[var(--color-border-light)]' : ''} ${isT ? 'bg-navy' : 'krs-cal'}`}
                        >
                          <div className={`font-sans text-[9px] font-bold uppercase tracking-[0.07em] mb-[5px] ${isT ? 'text-white/40' : 'text-[var(--color-text-muted)]'}`}>
                            {d.day}
                          </div>
                          <div className={`font-mono text-[28px] font-bold leading-none mb-[10px] ${isT ? 'text-white' : 'text-navy'}`}>
                            {d.date}
                          </div>
                          <div className="mb-2">
                            {d.type ? (
                              <span
                                className="rounded-[5px] px-[7px] py-[3px] text-[9px] font-sans font-bold uppercase tracking-[0.05em]"
                                style={isT
                                  ? { background: 'rgba(255,255,255,0.12)', color: '#ffffff' }
                                  : { background: s.bg, color: s.text }}
                              >
                                {d.type === 'cross_train' ? (d.title || 'Cross Train') : d.type}
                              </span>
                            ) : (
                              <span className={`font-sans text-[11px] ${isT ? 'text-white/20' : 'text-[#D4D8E8]'}`}>Rest</span>
                            )}
                          </div>
                          {d.miles ? (
                            <div className={`font-mono text-[16px] font-semibold ${isT ? 'text-coral' : 'text-navy'}`}>
                              {d.miles}<span className={`font-sans text-[10px] ${isT ? 'text-white/30' : 'text-[var(--color-text-muted)]'}`}> {unitLabel}</span>
                            </div>
                          ) : (
                            <div className={`font-sans text-[12px] ${isT ? 'text-white/20' : 'text-[#D4D8E8]'}`}>
                              {d.type ? '—' : 'Rest'}
                            </div>
                          )}
                          {d.count > 1 && (
                            <div className={`font-sans text-[9px] font-bold mt-1 ${isT ? 'text-white/50' : 'text-[var(--color-text-muted)]'}`}>
                              +{d.count - 1} more
                            </div>
                          )}
                          {d.done && <div className="absolute top-[10px] right-[10px] w-[7px] h-[7px] rounded-full bg-[#2ECC8B]" />}
                          {isT && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2px] bg-coral rounded-full" />}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* ② TODAY'S WORKOUT */}
              <div>
                <SLabel>Today's Workout</SLabel>
                {todayEntries.length > 0 ? (
                  <div className="flex flex-col gap-4">
                    {todayEntries.map(entry => {
                      const entryDist = entry.distance_km
                        ? parseFloat((entry.distance_km * 1000 / MPU).toFixed(1))
                        : null;
                      const entryType  = entry.workout_type || null;
                      const isCrossTrain = entryType === 'cross_train';
                      const entryHeading = entryType === 'Rest' || entryType === 'rest' ? 'Rest Day'
                        : isCrossTrain ? (entry.title || 'Cross Training')
                        : entryDist ? `${entryDist} ${unitLabel} ${entryType}`
                        : (entry.title || entryType || 'Workout');
                      const showSubtitle = !isCrossTrain && entry.title && entryHeading !== entry.title;
                      const segments = entryType ? getWorkoutSegments(entryType, entryDist, unit) : null;
                      return (
                        <div key={entry.id} className="bg-navy rounded-2xl overflow-hidden relative shadow-[0_6px_24px_rgba(27,37,89,0.15)]">
                          <div className="absolute left-0 top-0 bottom-0 w-[6px] bg-coral" />
                          <div className="absolute right-[-20px] top-[-20px] opacity-5 pointer-events-none">
                            <svg width="200" height="200" viewBox="0 0 100 100">
                              <circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeWidth="20" />
                            </svg>
                          </div>
                          <div className="p-6 pl-[30px] relative z-[1]">
                            <div className={`flex justify-between items-start ${segments ? 'mb-5' : ''}`}>
                              <div>
                                <div className="flex items-center gap-[10px] mb-2">
                                  <span className="font-sans text-[13px] font-bold text-white/60 uppercase tracking-[0.1em]">
                                    {new Date().toLocaleDateString('en-US', { weekday: 'long' })}
                                  </span>
                                  {entry.status === 'completed' && (
                                    <span className="bg-[rgba(46,204,139,0.15)] text-[#2ECC8B] rounded-[5px] px-2 py-[3px] text-[10px] font-sans font-bold uppercase tracking-[0.05em]">
                                      Done
                                    </span>
                                  )}
                                </div>
                                <div className="font-heading text-[26px] font-bold text-white leading-[1.1]">
                                  {entryHeading}
                                </div>
                                {showSubtitle && (
                                  <div className="font-sans text-[14px] text-white/70 leading-relaxed mt-[10px]">
                                    {entry.title}
                                  </div>
                                )}
                              </div>
                              {entry.status !== 'completed' && (
                                <div className="flex flex-col gap-2 items-end">
                                  <button
                                    onClick={() => calendarAPI.updateStatus(entry.id, 'completed').then(fetchWeekEntries)}
                                    className="bg-[#2ECC8B] text-white border-0 rounded-lg px-4 py-2 font-sans text-[13px] font-semibold cursor-pointer flex items-center gap-[6px]"
                                  >
                                    <LuCheck size={14} /> Mark Done
                                  </button>
                                  <button
                                    onClick={handlePlanWorkout}
                                    className="bg-white/10 text-white border border-white/20 rounded-lg px-4 py-2 font-sans text-[13px] font-semibold cursor-pointer"
                                  >
                                    Plan Activity
                                  </button>
                                </div>
                              )}
                            </div>
                            {segments && segments.length > 0 && (
                              <div className="bg-white/[0.06] rounded-xl p-4 border border-white/[0.08]">
                                <div className="font-sans text-[11px] font-bold text-white/40 uppercase tracking-[0.05em] mb-3">
                                  Workout Structure
                                </div>
                                <div className="flex flex-col gap-2">
                                  {segments.map((seg, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                      <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ background: seg.name === 'Warm-up' || seg.name === 'Cool-down' ? 'rgba(255,255,255,0.2)' : '#E8634A' }}
                                      />
                                      <div className="font-mono text-[14px] font-bold text-white w-[60px]">{seg.name}</div>
                                      <div className="font-sans text-[13px] text-white/70">{seg.detail}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white/50 rounded-2xl border border-dashed border-[#D4D8E8] h-[140px] flex items-center justify-center">
                    <div className="font-sans text-[14px] text-[var(--color-text-muted)]">No workout scheduled for today</div>
                  </div>
                )}
              </div>

              {/* Race Readiness */}
              <div>
                <Card>
                  <SLabel>Race Readiness</SLabel>
                  <div className="flex items-center gap-4 mb-4">
                    <Gauge score={readinessScore} />
                    <div>
                      <div
                        className="font-heading text-[22px] font-bold mb-1 tracking-[-0.01em] leading-[1.1]"
                        style={{ color: readinessColor }}
                      >{readinessLabel}</div>
                      <p className="font-sans text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                        {readinessScore >= 70
                          ? 'Strong base. Stay consistent and taper well.'
                          : readinessScore >= 50
                            ? 'Good progress. Keep building your long run and weekly volume.'
                            : 'Focus on consistency and gradual mileage increases.'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowFactors(!showFactors)}
                    className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-light)] rounded-[10px] py-[10px] font-sans text-[12px] font-bold text-[var(--color-text-secondary)] cursor-pointer flex items-center justify-center gap-[6px]"
                  >
                    {showFactors ? 'Hide' : 'Show'} breakdown
                    <span
                      className="inline-block transition-transform duration-300"
                      style={{ transform: showFactors ? 'rotate(180deg)' : 'none' }}
                    >▾</span>
                  </button>
                  {showFactors && (
                    <div className="mt-[14px] flex flex-col gap-[10px]">
                      {Object.entries(readinessFactors).filter(([k]) => k !== 'composite').map(([name, score]) => (
                        <div key={name}>
                          <div className="flex justify-between mb-[5px]">
                            <span className="font-sans text-[12px] font-semibold text-[var(--color-text-secondary)]">{name}</span>
                            <span
                              className="font-mono text-[13px] font-bold"
                              style={{ color: score >= 70 ? '#2ECC8B' : score >= 50 ? '#F5A623' : '#E84A4A' }}
                            >{score}</span>
                          </div>
                          <div className="h-[6px] bg-[var(--color-border-light)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${score}%`,
                                background: score >= 70 ? '#2ECC8B' : score >= 50 ? '#F5A623' : '#E84A4A',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Up Next */}
              {upNextEntries.length > 0 && (
                <Card>
                  <SLabel>Up Next</SLabel>
                  {upNextEntries.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-[14px] py-3"
                      style={{ borderBottom: i < upNextEntries.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}
                    >
                      <div className="w-11 h-11 rounded-xl bg-[var(--color-bg-elevated)] flex flex-col items-center justify-center shrink-0">
                        <span className="font-sans text-[9px] text-[var(--color-text-muted)] uppercase font-bold leading-none mb-[2px]">{d.day}</span>
                        <span className="font-mono text-[18px] font-bold text-navy leading-none">{d.date}</span>
                      </div>
                      <div>
                        {d.type && <Pill type={d.type} sm />}
                        {d.miles && <div className="font-sans text-[12px] font-semibold text-[var(--color-text-secondary)] mt-1">{d.miles} {unitLabel}</div>}
                        {!d.miles && d.title && <div className="font-sans text-[12px] font-semibold text-[var(--color-text-secondary)] mt-1">{d.title}</div>}
                      </div>
                    </div>
                  ))}
                </Card>
              )}

              {/* ③ METRIC CARDS */}
              <div>
                <SLabel>This Week</SLabel>
                <div className="grid grid-cols-3 gap-5">
                  {/* Weekly Mileage */}
                  <Card>
                    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[14px]">
                      Weekly Mileage
                    </div>
                    <div className="flex items-baseline gap-[6px] mb-1">
                      <span className="font-mono text-[42px] font-bold text-navy leading-none">{weeklyMileage}</span>
                      <span className="font-sans text-[14px] text-[var(--color-text-muted)] font-semibold">{unitLabel}</span>
                    </div>
                    <div className="font-sans text-[12px] text-[var(--color-text-muted)] mb-4">
                      of {weeklyTarget} {unitLabel} planned
                    </div>
                    <div className="h-[6px] bg-[var(--color-border-light)] rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-navy rounded-full"
                        style={{ width: `${Math.min(100, (weeklyMileage / weeklyTarget) * 100)}%` }}
                      />
                    </div>
                    {weeklyMilageDelta !== 0 && (
                      <span
                        className="font-sans text-[12px] font-semibold"
                        style={{ color: weeklyMilageDelta > 0 ? '#2ECC8B' : '#F5A623' }}
                      >
                        {weeklyMilageDelta > 0 ? '▲' : '▼'} {Math.abs(weeklyMilageDelta)} {unitLabel} vs last week
                      </span>
                    )}
                  </Card>

                  {/* Aerobic Efficiency */}
                  <Card>
                    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[14px]">
                      Aerobic Efficiency
                    </div>
                    {aerobicEffImprovement !== null ? (
                      <>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span
                            className="font-mono text-[42px] font-bold leading-none"
                            style={{ color: aerobicEffImprovement >= 0 ? '#1B2559' : '#F5A623' }}
                          >
                            {aerobicEffImprovement > 0 ? '+' : ''}{aerobicEffImprovement}
                            <span className="text-[22px]">%</span>
                          </span>
                        </div>
                        <div className="font-sans text-[12px] text-[var(--color-text-muted)] mb-[14px]">
                          faster at same HR vs 8 weeks ago
                        </div>
                        <ResponsiveContainer width="100%" height={36} style={{ marginBottom: 12 }}>
                          <LineChart data={aerobicEffData.filter(w => w.eff !== null)}>
                            <YAxis domain={['dataMin - 0.001', 'dataMax + 0.001']} hide />
                            <Line
                              type="monotone" dataKey="eff"
                              stroke={aerobicEffImprovement >= 0 ? '#2ECC8B' : '#F5A623'}
                              strokeWidth={2.5} dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                        <span
                          className="font-sans text-[12px] font-semibold"
                          style={{ color: aerobicEffImprovement >= 0 ? '#2ECC8B' : '#F5A623' }}
                        >
                          {aerobicEffImprovement >= 0 ? '▲ Aerobic engine improving' : '▼ Monitor training stress'}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="font-mono text-[42px] font-bold text-[#D4D8E8] leading-none mb-[10px]">—</div>
                        <div className="font-sans text-[12px] text-[var(--color-text-muted)]">
                          Sync HR data to track aerobic efficiency
                        </div>
                      </>
                    )}
                  </Card>

                  {/* Training Load */}
                  <Card>
                    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[14px]">
                      Training Load
                    </div>
                    <div className="flex items-baseline gap-[10px] mb-1">
                      <span className="font-mono text-[42px] font-bold text-navy leading-none">{trainingLoadScore}</span>
                      <span
                        className="font-sans text-[16px] font-bold"
                        style={{ color: trainingLoadScore >= 85 ? '#E8634A' : trainingLoadScore >= 60 ? '#F5A623' : '#2ECC8B' }}
                      >{trainingLoadLabel}</span>
                    </div>
                    <div className="font-sans text-[12px] text-[var(--color-text-muted)] mb-4">
                      Volume vs target · {weeklyRunCount} run{weeklyRunCount !== 1 ? 's' : ''} this week
                    </div>
                    <div className="h-[6px] bg-[var(--color-border-light)] rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${trainingLoadScore}%`, background: 'linear-gradient(90deg,#2ECC8B,#F5A623)' }}
                      />
                    </div>
                    <span className="font-sans text-[12px] font-semibold text-[#2ECC8B]">
                      {trainingLoadScore >= 60 ? '▲ Trending up' : '— Building volume'}
                    </span>
                  </Card>
                </div>
              </div>

              {/* ④ TRAINING TRENDS */}
              <div>
                <SLabel>Training Trends</SLabel>
                <div className="grid grid-cols-2 gap-5">
                  {/* Weekly Mileage chart */}
                  <Card>
                    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[2px]">
                      Weekly Mileage
                    </div>
                    <div className="font-sans text-[12px] text-[var(--color-text-muted)] mb-5">8-week history</div>
                    {weeklyChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={weeklyChartData} barSize={20} barCategoryGap="20%">
                          <XAxis dataKey="week" tick={chartTheme.axis.tick} axisLine={false} tickLine={false} tickMargin={8} />
                          <YAxis hide />
                          <Tooltip content={({ active, payload, label }) => <Tip active={active} payload={payload} label={label} unit={` ${unitLabel}`} />} cursor={{ fill: 'rgba(27,37,89,0.02)' }} />
                          <Bar dataKey="miles" radius={[4, 4, 0, 0]}>
                            {weeklyChartData.map((_, idx) => (
                              <Cell key={idx} fill={idx === weeklyChartData.length - 1 ? '#E8634A' : '#1B2559'} fillOpacity={idx === weeklyChartData.length - 1 ? 1 : 0.4} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[160px] flex items-center justify-center font-sans text-[13px] text-[var(--color-text-muted)]">
                        No data — sync your activities
                      </div>
                    )}
                  </Card>

                  {/* Effort Distribution */}
                  <Card>
                    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[2px]">
                      Effort Distribution
                    </div>
                    <div className="font-sans text-[12px] text-[var(--color-text-muted)] mb-5">
                      Time in zone this week ·{' '}
                      {effortDist.reduce((s, z) => s + z.mins, 0) > 0
                        ? `${Math.round(effortDist.reduce((s, z) => s + z.mins, 0))} min total`
                        : 'No data yet'}
                    </div>
                    {effortDist.map((z, i) => {
                      const onTarget = z.pct >= 10;
                      return (
                        <div key={i} className={i < effortDist.length - 1 ? 'mb-[14px]' : ''}>
                          <div className="flex justify-between items-center mb-[6px]">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: z.color }} />
                              <span className="font-sans text-[13px] font-semibold text-[var(--color-text-secondary)]">{z.zone}</span>
                              <span className="font-sans text-[11px] text-[var(--color-text-muted)]">{z.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {z.mins > 0 && <span className="font-sans text-[11px] text-[var(--color-text-muted)]">{Math.round(z.mins)}m</span>}
                              <span className="font-mono text-[13px] font-bold text-navy">{z.pct}%</span>
                              {onTarget && <LuCheck size={12} className="text-[var(--color-success)]" />}
                            </div>
                          </div>
                          <div className="h-[6px] bg-[var(--color-border-light)] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${z.pct}%`, background: z.color }} />
                          </div>
                        </div>
                      );
                    })}
                    {effortDist.length > 0 && effortDist[0].pct + effortDist[1].pct > 0 && (
                      <div className="mt-4 px-3 py-[10px] bg-[var(--color-bg-elevated)] rounded-lg">
                        <span className="font-sans text-[12px] text-[var(--color-text-secondary)]">
                          💡 Z1+Z2 = <span className="font-bold text-[#2ECC8B]">{effortDist[0].pct + effortDist[1].pct}%</span>
                          {effortDist[0].pct + effortDist[1].pct >= 70 ? ' — precise aerobic base building' : ' — aim for 70%+ in Z1–Z2'}
                        </span>
                      </div>
                    )}
                  </Card>
                </div>
              </div>

              {/* ⑤ RECENT RUNS */}
              <div>
                <SLabel action={<span className="font-sans text-[11px] text-[var(--color-text-muted)]">via Strava</span>}>
                  Recent Runs
                </SLabel>
                {recentRuns.length > 0 ? (
                  <Card style={{ padding: 0 }}>
                    <div
                      className="grid gap-4 px-6 py-3 border-b border-[var(--color-border-light)]"
                      style={{ gridTemplateColumns: RUN_TABLE_COLS }}
                    >
                      {RUN_TABLE_HEADERS.map((h, i) => (
                        <span
                          key={h}
                          className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.09em]"
                          style={{ textAlign: i >= 2 ? 'right' : 'left' }}
                        >{h}</span>
                      ))}
                    </div>
                    {recentRuns.map((r, i) => {
                      const hr      = r.average_heart_rate;
                      const hrColor = hr >= 165 ? '#E84A4A' : hr <= 145 ? '#2ECC8B' : '#F5A623';
                      const distMi  = parseFloat(((r.distance_meters || 0) / MPU).toFixed(1));
                      const elevFt  = Math.round((r.elevation_gain || 0) * 3.28084);
                      const runType = r.workout_type || 'Easy';
                      return (
                        <div
                          key={i}
                          className="krs-rr grid gap-4 px-6 py-4 items-center transition-colors"
                          style={{
                            gridTemplateColumns: RUN_TABLE_COLS,
                            background: 'transparent',
                            borderBottom: i < recentRuns.length - 1 ? '1px solid #F8F9FC' : 'none',
                          }}
                        >
                          <span className="font-sans text-[13px] font-medium text-[var(--color-text-secondary)]">
                            {new Date(r.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          <span><Pill type={runType} /></span>
                          <span className="font-mono text-[20px] font-bold text-navy text-right">
                            {distMi}<span className="text-[12px] font-medium text-[var(--color-text-muted)]"> {unitLabel}</span>
                          </span>
                          <span className="font-mono text-[14px] text-navy text-right">
                            {fmtPace(r.average_pace_seconds_per_km)}
                          </span>
                          <span className="font-mono text-[13px] text-[var(--color-text-secondary)] text-right">
                            {r.duration_seconds ? fmtTime(r.duration_seconds) : r.moving_time_seconds ? fmtTime(r.moving_time_seconds) : '—'}
                          </span>
                          <span
                            className="font-mono text-[13px] font-semibold text-right"
                            style={{ color: hr ? hrColor : '#8B93B0' }}
                          >
                            {hr ? <>{hr}<span className="font-sans text-[10px] font-medium text-[var(--color-text-muted)]"> bpm</span></> : '—'}
                          </span>
                          <span className="font-mono text-[13px] text-[#4A6CF7] text-right">
                            {elevFt > 0 ? <>↑{elevFt}<span className="font-sans text-[10px] text-[var(--color-text-muted)]"> ft</span></> : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </Card>
                ) : (
                  <Card>
                    <div className="text-center py-6 font-sans text-[14px] text-[var(--color-text-muted)]">
                      No runs yet — sync your Strava activities to see them here
                    </div>
                  </Card>
                )}
              </div>

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
