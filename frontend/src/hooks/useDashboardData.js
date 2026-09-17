import { useCallback, useEffect, useState } from 'react';
import { goalsAPI } from '../api/goals';
import { activitiesAPI } from '../api/activities';
import { calendarAPI } from '../api/calendar';
import { dashboardAPI } from '../api/dashboard';
import { coachAPI } from '../api/coach';
import { fmtDateISO } from '../lib/dashboardHelpers';

// useDashboardData centralizes the Dashboard page's read-only data fetches —
// active goal, activities, this week's calendar entries, the AI coach
// insight (with its own per-day localStorage cache), and the aggregated
// dashboard payload — and fires them once on mount.
//
// It intentionally does NOT fetch activities as part of its own mount effect.
// Dashboard.jsx's Strava auto-sync-if-empty check needs to await
// fetchActivities() and conditionally call useStravaSync's sync(), which
// depends on this hook's fetchActivities/fetchDashboardData as its onSuccess
// callbacks — fetching activities here as well would double-fetch on mount.
// fetchActivities is still owned and exposed by this hook; the page just
// decides when to call it.
export function useDashboardData() {
  const [activeGoal, setActiveGoal] = useState(null);
  const [activities, setActivities] = useState([]);
  const [weekEntries, setWeekEntries] = useState([]);
  const [insight, setInsight] = useState(null);
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

  useEffect(() => {
    fetchActiveGoal();
    fetchWeekEntries();
    fetchDashboardData();
    fetchInsight();
  }, [fetchActiveGoal, fetchWeekEntries, fetchDashboardData, fetchInsight]);

  return {
    activeGoal,
    activities,
    weekEntries,
    insight,
    dashboardData,
    fetchActiveGoal,
    fetchActivities,
    fetchDashboardData,
    fetchInsight,
    fetchWeekEntries,
  };
}
