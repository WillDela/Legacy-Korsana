import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUnits } from '../context/UnitsContext';
import { formatPace, distanceLabel } from '../utils/units';
import { stravaAPI } from '../api/strava';
import { calendarAPI } from '../api/calendar';
import SessionDetailsModal from '../components/SessionDetailsModal';
import AppPageHero from '../components/ui/AppPageHero';
import MetricStrip from '../components/ui/MetricStrip';
import BriefingPanel from '../components/ui/BriefingPanel';
import { getStravaRedirectState, clearStravaRedirectParams } from '../lib/stravaRedirect';
import { useStravaSync } from '../hooks/useStravaSync';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import { PHASE_VARIANT } from '../lib/dashboardConstants';
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

  const {
    activeGoal, activities, weekEntries, insight, dashboardData,
    fetchActivities, fetchDashboardData, fetchWeekEntries,
  } = useDashboardData();
  const [stravaConnected, setStravaConnected] = useState(null);

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

  // useDashboardData fetches activeGoal/weekEntries/dashboardData/insight on
  // its own mount. Activities are fetched here instead, since whether to
  // trigger a Strava auto-sync depends on the result, and syncStravaActivities
  // (from useStravaSync above) already uses this hook's fetchActivities and
  // fetchDashboardData as its onSuccess callbacks.
  useEffect(() => {
    (async () => {
      const acts = await fetchActivities();
      if (!acts.length) syncStravaActivities();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, matches prior behavior
  }, []);

  const {
    todayISO, trainingPhase, heroSubtitle, priorityMetrics,
    weeklyMileage, weeklyTarget, weeklyMilageDelta, weeklyRunCount,
    trainingLoadScore, trainingLoadLabel, aerobicEffData, aerobicEffImprovement,
    readinessFactors, readinessScore, readinessLabel, readinessColor,
    weeklyChartData, effortDist, todayEntries, calendarStrip, upNextEntries,
    recentRuns, widgetData,
  } = useDashboardMetrics({ activeGoal, activities, weekEntries, dashboardData, unit, MPU });

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
          onClick: stravaConnected === false ? handleConnectStrava : () => syncStravaActivities(),
          disabled: isSyncing,
          icon: stravaConnected === false ? null : (
            <svg className={isSyncing ? 'animate-spin' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          ),
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
