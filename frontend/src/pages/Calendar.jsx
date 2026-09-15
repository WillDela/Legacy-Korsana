import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { calendarAPI } from '../api/calendar';
import { stravaAPI } from '../api/strava';
import { goalsAPI } from '../api/goals';
import SessionDetailsModal, { WORKOUT_TYPES } from '../components/SessionDetailsModal';
import ManualActivityModal from '../components/ManualActivityModal';
import WeekCalendar from '../components/WeekCalendar';
import AppPageHero from '../components/ui/AppPageHero';
import MetricStrip from '../components/ui/MetricStrip';
import WorkoutCard from '../components/ui/WorkoutCard';
import { useUnits } from '../context/UnitsContext';
import { formatDistance, distanceLabel } from '../utils/units';
import { todayKeyInTZ, formatDateInTZ } from '../lib/userTimezone';
import { getStravaRedirectState, clearStravaRedirectParams } from '../lib/stravaRedirect';
import { useStravaSync } from '../hooks/useStravaSync';

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// Maps backend workout_type values to WorkoutCard display types
const WORKOUT_TYPE_TO_CARD = {
  easy:        'Easy',
  long:        'Long Run',
  tempo:       'Tempo',
  interval:    'Intervals',
  cycling:     'Cycling',
  swimming:    'Swimming',
  lifting:     'Cross-Train',
  walking:     'Easy',
  cross_train: 'Cross-Train',
  recovery:    'Recovery',
  rest:        'Rest',
  race:        'Long Run',
};

// Returns raw "M:SS" pace string (without unit suffix) for WorkoutCard
const rawPace = (secPerKm, unit) => {
  if (!secPerKm || secPerKm <= 0) return null;
  const total = unit === 'imperial' ? secPerKm * 1.60934 : secPerKm;
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
};

const formatDateKey = (date) => {
  if (typeof date === 'string' && date.length >= 10) {
    return date.slice(0, 10);
  }
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
};

const todayKey = () => formatDateKey(new Date());

const getGridRange = (month) => {
  const year = month.getFullYear();
  const mo = month.getMonth();
  const first = new Date(year, mo, 1);
  let dayOfWeek = first.getDay();
  if (dayOfWeek === 0) dayOfWeek = 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - (dayOfWeek - 1));
  const last = new Date(year, mo + 1, 0);
  let lastDow = last.getDay();
  if (lastDow === 0) lastDow = 7;
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (7 - lastDow));
  return { gridStart, gridEnd };
};

const getGridDates = (gridStart, gridEnd) => {
  const dates = [];
  const d = new Date(gridStart);
  while (d <= gridEnd) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
};

const MiniCard = ({ entry, unit = 'imperial' }) => {
  const status = entry.status || 'planned';
  const isMissed = status === 'missed';
  const isCompleted = status === 'completed';
  const isSynced = status === 'synced' || entry.source === 'strava';
  const isAdapted = status === 'adapted';
  const typeInfo = WORKOUT_TYPES.find((w) => w.value === entry.workout_type);
  const accentColor = typeInfo?.color || '#6B7280';

  // Compact distance label for tight calendar cells
  const distShort = entry.planned_distance_meters > 0
    ? unit === 'imperial'
      ? `${(entry.planned_distance_meters / 1609.34).toFixed(1)}m`
      : `${(entry.planned_distance_meters / 1000).toFixed(1)}k`
    : null;

  const cellStyle = isMissed
    ? { border: '1.5px dashed #D1D5DB', background: 'transparent' }
    : { borderLeft: `2.5px solid ${accentColor}`, background: `${accentColor}12` };

  return (
    <div
      className={`flex items-center gap-1 rounded px-1 py-0.5 min-w-0 ${isMissed ? 'opacity-50' : ''}`}
      style={cellStyle}
    >
      {isSynced && (
        <span className="text-[7px] font-bold text-orange-500 flex-shrink-0 leading-none">S</span>
      )}
      {isCompleted && !isSynced && (
        <span className="text-[7px] font-bold flex-shrink-0 leading-none" style={{ color: accentColor }}>✓</span>
      )}
      {isAdapted && (
        <span className="text-[7px] font-bold text-amber-500 flex-shrink-0 leading-none">✦</span>
      )}
      <span className={`text-[10px] font-semibold truncate flex-1 leading-tight ${
        isMissed ? 'text-gray-400 line-through' : 'text-text-primary'
      }`}>
        {entry.title}
      </span>
      {distShort && !isMissed && (
        <span className="text-[8px] font-mono text-text-muted flex-shrink-0 leading-none">
          {distShort}
        </span>
      )}
    </div>
  );
};

const DayDetailModal = ({
  isOpen,
  onClose,
  date,
  entries,
  onAddWorkout,
  onLogActivity,
  onEditEntry,
  onMarkComplete,
}) => {
  const { unit } = useUnits();
  if (!isOpen || !date) return null;

  const dateObj = new Date(date + 'T12:00:00');
  const formatted = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(17,25,64,0.5)' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 bg-navy text-white flex items-center justify-between">
              <div>
                <h3
                  className="text-lg font-bold"
                  style={{ fontFamily: 'var(--font-heading)' }}
                >
                  {formatted}
                </h3>
                <p className="text-white/60 text-xs mt-0.5">
                  {entries.length} {entries.length === 1 ? 'activity' : 'activities'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white cursor-pointer bg-transparent border-none transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Entries list — agenda style */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {entries.length === 0 && (
                <div className="text-center py-10">
                  <div className="w-12 h-12 rounded-full bg-bg-app flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <p className="text-sm text-text-muted">No activities yet</p>
                  <p className="text-xs text-text-muted/60 mt-1">Add a workout or log an activity</p>
                </div>
              )}

              {/* Planned / upcoming section */}
              {entries.filter(e => e.status === 'planned' || e.status === 'adapted').length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2 px-0.5">
                    Upcoming
                  </p>
                  <div className="space-y-2">
                    {entries.filter(e => e.status === 'planned' || e.status === 'adapted').map(entry => {
                      const distValue = entry.planned_distance_meters > 0
                        ? parseFloat((entry.planned_distance_meters / (unit === 'imperial' ? 1609.34 : 1000)).toFixed(1))
                        : null;
                      return (
                        <div key={entry.id} className="flex flex-col gap-1.5">
                          <WorkoutCard
                            type={WORKOUT_TYPE_TO_CARD[entry.workout_type] || 'Easy'}
                            title={entry.title}
                            purpose={entry.description || null}
                            distance={distValue}
                            unit={unit === 'imperial' ? 'mi' : 'km'}
                            pace={rawPace(entry.planned_pace_per_km, unit)}
                            duration={entry.planned_duration_minutes ? `${entry.planned_duration_minutes}m` : null}
                            status={entry.status}
                            source={entry.source}
                            adaptationNote={entry.adaptation_note || null}
                            onClick={() => onEditEntry(entry)}
                          />
                          <div className="flex gap-2 px-0.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); onMarkComplete(entry.id); }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] text-[var(--color-success)] text-[11px] font-bold border border-[var(--color-success)]/30 cursor-pointer hover:bg-[var(--color-success)]/10 transition-colors"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Mark Complete
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onLogActivity(); }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white text-[var(--color-text-secondary)] text-[11px] font-bold border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                              </svg>
                              Log Activity
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Completed / synced section */}
              {entries.filter(e => e.status === 'completed' || e.status === 'synced').length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2 px-0.5">
                    Completed
                  </p>
                  <div className="space-y-2">
                    {entries.filter(e => e.status === 'completed' || e.status === 'synced').map(entry => {
                      const distValue = entry.planned_distance_meters > 0
                        ? parseFloat((entry.planned_distance_meters / (unit === 'imperial' ? 1609.34 : 1000)).toFixed(1))
                        : null;
                      return (
                        <WorkoutCard
                          key={entry.id}
                          type={WORKOUT_TYPE_TO_CARD[entry.workout_type] || 'Easy'}
                          title={entry.title}
                          purpose={entry.description || null}
                          distance={distValue}
                          unit={unit === 'imperial' ? 'mi' : 'km'}
                          pace={rawPace(entry.planned_pace_per_km, unit)}
                          duration={entry.planned_duration_minutes ? `${entry.planned_duration_minutes}m` : null}
                          status={entry.status}
                          source={entry.source}
                          adaptationNote={entry.adaptation_note || null}
                          onClick={() => onEditEntry(entry)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Missed section */}
              {entries.filter(e => e.status === 'missed').length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2 px-0.5">
                    Missed
                  </p>
                  <div className="space-y-2">
                    {entries.filter(e => e.status === 'missed').map(entry => {
                      const distValue = entry.planned_distance_meters > 0
                        ? parseFloat((entry.planned_distance_meters / (unit === 'imperial' ? 1609.34 : 1000)).toFixed(1))
                        : null;
                      return (
                        <WorkoutCard
                          key={entry.id}
                          type={WORKOUT_TYPE_TO_CARD[entry.workout_type] || 'Easy'}
                          title={entry.title}
                          purpose={entry.description || null}
                          distance={distValue}
                          unit={unit === 'imperial' ? 'mi' : 'km'}
                          status="missed"
                          source={entry.source}
                          onClick={() => onEditEntry(entry)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border flex gap-2.5 bg-bg-app/50">
              <button
                onClick={onAddWorkout}
                className="flex-1 px-3 py-2.5 rounded-xl bg-navy text-white text-sm font-semibold cursor-pointer border-none hover:bg-navy-light transition-colors flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Workout
              </button>
              <button
                onClick={onLogActivity}
                className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-white text-text-secondary text-sm font-medium cursor-pointer hover:bg-bg-elevated transition-colors flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Log Activity
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Calendar = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const m = searchParams.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      const [y, mo] = m.split('-').map(Number);
      return new Date(y, mo - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(null); // null=unknown, false=not connected
  const [activeGoal, setActiveGoal] = useState(null);
  const { unit } = useUnits();

  const [view, setView] = useState(() => {
    const v = searchParams.get('view');
    return ['month', 'week', 'day'].includes(v) ? v : 'month';
  });
  const [filterType, setFilterType] = useState('all');

  const { gridStart, gridEnd } = useMemo(
    () => getGridRange(currentMonth),
    [currentMonth]
  );

  const gridDates = useMemo(
    () => getGridDates(gridStart, gridEnd),
    [gridStart, gridEnd]
  );

  const entriesByDate = useMemo(() => {
    const map = {};
    for (const entry of entries) {
      if (filterType !== 'all' && entry.workout_type !== filterType) {
        continue;
      }
      const key = formatDateKey(entry.date);
      if (!map[key]) map[key] = [];
      map[key].push(entry);
    }
    return map;
  }, [entries, filterType]);

  const monthStats = useMemo(() => {
    const completed = entries.filter((e) => e.status === 'completed').length;
    const planned = entries.filter((e) => e.status === 'planned').length;
    const totalDist = entries.reduce(
      (sum, e) => sum + (e.planned_distance_meters || 0), 0
    );
    return { completed, planned };
  }, [entries]);

  const fetchMonthEntries = useCallback(async () => {
    try {
      setLoading(true);
      const startStr = formatDateKey(gridStart);
      const endStr = formatDateKey(gridEnd);
      const data = await calendarAPI.getRange(startStr, endStr);
      setEntries(data.entries || []);
    } catch (err) {
      console.error('Failed to fetch calendar entries:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [gridStart, gridEnd]);

  const { syncing, syncMessage, sync: syncStrava, showMessage: showSyncMessage } = useStravaSync({
    onSuccess: async () => {
      setStravaConnected(true);
      await fetchMonthEntries();
    },
    onNotConnected: () => setStravaConnected(false),
  });

  useEffect(() => {
    fetchMonthEntries();
  }, [fetchMonthEntries]);

  useEffect(() => {
    goalsAPI.getActiveGoal().then(setActiveGoal).catch(() => {});
  }, []);

  // Week bounds as YYYY-MM-DD strings in the user's timezone. Strings avoid
  // every browser-local Date pitfall: entries carry server-side local_date
  // strings (already user-TZ), so string compare === user-TZ compare.
  const weekKeys = useMemo(() => {
    const today = todayKeyInTZ();
    // Parse as UTC midnight to do pure integer-day arithmetic.
    const base = new Date(`${today}T00:00:00Z`);
    const dow = base.getUTCDay(); // 0=Sun..6=Sat
    const monOffset = dow === 0 ? -6 : 1 - dow;
    const shift = (anchor, days) => {
      const d = new Date(anchor);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const current = shift(base, monOffset);
    const currentBase = new Date(`${current}T00:00:00Z`);
    return {
      currentStart: current,
      currentEnd: shift(currentBase, 6),
      lastStart: shift(currentBase, -7),
      lastEnd: shift(currentBase, -1),
    };
  }, []);

  // Hero stats derived from the loaded month entries
  const heroData = useMemo(() => {
    const entryKey = (e) => (e.date || '').slice(0, 10);
    const within = (key, start, end) => key >= start && key <= end;
    const thisWeek = entries.filter((e) =>
      within(entryKey(e), weekKeys.currentStart, weekKeys.currentEnd),
    );
    const lastWeek = entries.filter((e) =>
      within(entryKey(e), weekKeys.lastStart, weekKeys.lastEnd),
    );
    const plannedVol = thisWeek.reduce((s, e) => s + (e.planned_distance_meters || 0), 0);
    const keyWorkout = thisWeek.reduce((best, e) => {
      if (!best || (e.planned_distance_meters || 0) > (best.planned_distance_meters || 0)) return e;
      return best;
    }, null);
    const lastWeekDone = lastWeek.filter(
      (e) => e.status === 'completed' || e.status === 'synced'
    ).length;
    const lastWeekTracked = lastWeek.filter((e) => e.status !== 'planned').length;
    const execScore = lastWeekTracked > 0
      ? Math.round((lastWeekDone / lastWeekTracked) * 100)
      : null;
    return { plannedVol, keyWorkout, execScore };
  }, [entries, weekKeys]);

  const weeksToRace = useMemo(() => {
    if (!activeGoal?.race_date) return null;
    const diff = new Date(activeGoal.race_date) - new Date();
    return Math.max(0, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000)));
  }, [activeGoal]);

  const trainingPhase = useMemo(() => {
    if (weeksToRace === null) return null;
    if (weeksToRace > 12) return 'Base';
    if (weeksToRace > 6) return 'Build';
    if (weeksToRace > 3) return 'Peak';
    return 'Taper';
  }, [weeksToRace]);

  const heroSubtitle = useMemo(() => {
    const weekLabel = formatDateInTZ(
      `${weekKeys.currentStart}T12:00:00Z`,
      { month: 'short', day: 'numeric' },
      'UTC',
    );
    return [
      `Week of ${weekLabel}`,
      trainingPhase && `${trainingPhase} phase`,
      weeksToRace !== null && `${weeksToRace} week${weeksToRace !== 1 ? 's' : ''} to race`,
    ].filter(Boolean).join(' · ');
  }, [weekKeys.currentStart, trainingPhase, weeksToRace]);

  const keyWorkoutBadge = heroData.keyWorkout
    ? { label: heroData.keyWorkout.title || 'Key Workout', variant: 'neutral', size: 'sm' }
    : null;

  const heroMetrics = useMemo(() => {
    const unitLbl = distanceLabel(unit);
    const volParts = heroData.plannedVol > 0
      ? formatDistance(heroData.plannedVol, unit).split(' ')
      : ['0', unitLbl];
    return [
      {
        label: 'This Week',
        value: volParts[0],
        unit: volParts[1] || unitLbl,
        variant: 'neutral',
      },
      {
        label: 'Last Week Execution',
        value: heroData.execScore !== null ? `${heroData.execScore}%` : '—',
        variant: heroData.execScore !== null && heroData.execScore >= 80
          ? 'success'
          : heroData.execScore !== null && heroData.execScore >= 50
            ? 'warning'
            : 'neutral',
      },
      {
        label: 'Month Completed',
        value: String(monthStats.completed),
        variant: 'neutral',
      },
    ];
  }, [heroData, unit, monthStats.completed]);

  // Persist view + month in URL so the page is shareable and survives refresh
  useEffect(() => {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (view !== 'month') next.set('view', view); else next.delete('view');
      if (monthStr !== defaultMonth) next.set('month', monthStr); else next.delete('month');
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentMonth]);

  const handleConnectStrava = async () => {
    try {
      const data = await stravaAPI.getAuthURL('/calendar');
      window.location.href = data.url;
    } catch {
      showSyncMessage('Could not start Strava connect. Try again from Settings.', 'error', 4000);
    }
  };

  const navigateMonth = (dir) => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1)
    );
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  useEffect(() => {
    const redirectState = getStravaRedirectState(searchParams);
    if (!redirectState) return;

    clearStravaRedirectParams(setSearchParams);

    if (redirectState.type === 'success') {
      showSyncMessage('Strava connected. Pulling in your latest activities...', 'success', 5000);
      syncStrava({ afterConnect: true });
      return;
    }

    showSyncMessage(redirectState.text, 'error', 5000);
  }, [searchParams, setSearchParams, showSyncMessage, syncStrava]);

  const handleDayClick = (dateKey) => {
    setSelectedDate(dateKey);
  };

  const handleAddWorkout = () => {
    setEditingEntry(null);
    setModalMode('session');
  };

  const handleLogActivity = () => {
    setModalMode('log');
  };

  const handleEditEntry = (entry) => {
    setSelectedDate(formatDateKey(entry.date));
    setEditingEntry(entry);
    setModalMode('session');
  };

  const handleSaveEntry = async (data) => {
    if (editingEntry?.id) {
      await calendarAPI.updateEntry(editingEntry.id, data);
    } else {
      await calendarAPI.createEntry(data);
    }
    await fetchMonthEntries();
    setModalMode(null);
    setEditingEntry(null);
  };

  const handleDeleteEntry = async (id) => {
    await calendarAPI.deleteEntry(id);
    await fetchMonthEntries();
    setModalMode(null);
    setEditingEntry(null);
  };

  const handleQuickAdd = () => {
    setSelectedDate(todayKey());
    setEditingEntry(null);
    setModalMode('session');
  };

  const handleMarkComplete = useCallback(async (entryId) => {
    try {
      await calendarAPI.updateStatus(entryId, 'completed');
      await fetchMonthEntries();
    } catch (err) {
      console.error('Failed to mark complete:', err);
    }
  }, [fetchMonthEntries]);

  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const today = todayKey();
  const currentMonthNum = currentMonth.getMonth();

  const weeks = [];
  for (let i = 0; i < gridDates.length; i += 7) {
    weeks.push(gridDates.slice(i, i + 7));
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero */}
      <AppPageHero
        title="Training Calendar"
        subtitle={heroSubtitle}
        status={keyWorkoutBadge}
        primaryAction={{ label: '+ Log Workout', onClick: handleQuickAdd }}
      >
        <MetricStrip metrics={heroMetrics} />
      </AppPageHero>

      {/* Controls Bar */}
      <div className="bg-white rounded-xl border border-border shadow-sm p-3 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Side: View Tabs + Nav */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* View Tabs */}
          <div className="flex items-center p-0.5 bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border-light)]">
            {['month', 'week', 'day'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-colors ${view === v
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-navy hover:bg-white'
                  }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-border hidden md:block" />

          <div className="flex items-center gap-1">
            <h2 className="text-lg font-bold text-navy w-32" style={{ fontFamily: 'var(--font-heading)' }}>
              {monthLabel}
            </h2>
            <button
              onClick={() => navigateMonth(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-app text-text-secondary transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-app text-text-secondary transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="h-4 w-[1px] bg-border hidden md:block" />

          <button
            onClick={goToToday}
            className="text-xs font-bold text-text-secondary hover:text-navy transition-colors"
          >
            Today
          </button>

          {stravaConnected === false ? (
            <button
              onClick={handleConnectStrava}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors text-xs font-bold"
              title="Connect Strava to sync activities"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Connect Strava
            </button>
          ) : (
            <button
              onClick={() => syncStrava()}
              disabled={syncing}
              className={`w-8 h-8 flex items-center justify-center rounded-lg border border-border transition-colors ${syncing ? 'bg-bg-app text-text-muted cursor-not-allowed' : 'bg-white hover:bg-bg-app text-orange-500 hover:text-orange-600 hover:border-orange-200'
                }`}
              title="Sync Strava"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}
          {syncMessage.text && (
            <span className={`text-xs font-medium ${syncMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {syncMessage.text}
            </span>
          )}
        </div>

        {/* Right Side: Filters */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#82A895]" />
              Completed
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-navy" />
              Upcoming
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              Missed
            </div>
          </div>

          <div className="h-4 w-[1px] bg-border hidden md:block" />

          <div className="relative">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="appearance-none pl-3 pr-8 py-1.5 bg-transparent text-sm font-bold text-navy outline-none cursor-pointer hover:bg-bg-app rounded-md transition-colors"
            >
              <option value="all">All Activities</option>
              {WORKOUT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-navy">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Views */}
      {
        view === 'week' ? (
          <WeekCalendar
            currentMonth={currentMonth}
            entriesByDate={entriesByDate}
            onDayClick={handleDayClick}
          />
        ) : view === 'day' ? (
          (() => {
            const displayDate = selectedDate || today;
            const entries = entriesByDate[displayDate] || [];
            const displayDateObj = new Date(displayDate + 'T12:00:00');
            const isToday = displayDate === today;
            const dateTitle = isToday ? "Today's Schedule" : displayDateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            return (
              <div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-white">
                <div className="p-6 border-b border-border flex justify-between items-center bg-[#F8FAFF]">
                  <div>
                    <h2 className="text-2xl font-bold text-navy flex items-center gap-3" style={{ fontFamily: 'var(--font-heading)' }}>
                      {dateTitle}
                      {isToday && <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold bg-navy text-white">Today</span>}
                    </h2>
                    <p className="text-text-secondary text-sm mt-1">Detailed breakdown of your planned activities.</p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-navy font-mono leading-none">{entries.length}</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mt-1">Activities</div>
                  </div>
                </div>

                <div className="p-0">
                  {entries.length > 0 ? (
                    <div className="divide-y divide-border">
                      {entries.map(entry => {
                        const typeInfo = WORKOUT_TYPES.find((w) => w.value === entry.workout_type);
                        const accentColor = typeInfo?.color || '#6B7280';
                        const distDisplay = entry.planned_distance_meters > 0
                          ? formatDistance(entry.planned_distance_meters, unit)
                          : null;

                        return (
                          <div
                            key={entry.id}
                            className="p-6 flex items-start gap-5 hover:bg-bg-app transition-colors group cursor-pointer"
                            onClick={() => handleEditEntry(entry)}
                          >
                            <div className="mt-1 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${accentColor}15`, color: accentColor }}>
                              <span className="font-bold text-lg">{typeInfo?.badge?.charAt(0) || 'A'}</span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-lg font-bold text-text-primary truncate">{entry.title}</h3>
                                {entry.source === 'strava' && <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded leading-none">S</span>}
                              </div>

                              <p className="text-sm text-text-secondary mb-3 leading-relaxed max-w-2xl">
                                {entry.description || 'No description provided.'}
                              </p>

                              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-text-muted">
                                {distDisplay && (
                                  <span className="flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
                                    {distDisplay}
                                  </span>
                                )}
                                {entry.planned_duration_minutes > 0 && (
                                  <span className="flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                    {entry.planned_duration_minutes} min
                                  </span>
                                )}
                                {entry.status && (
                                  <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-widest text-[9px] ${entry.status === 'completed' ? 'bg-[#82A895]/20 text-[#82A895]' :
                                    entry.status === 'missed' ? 'bg-gray-100 text-gray-500' : 'bg-navy/10 text-navy'
                                    }`}>
                                    {entry.status}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted flex-shrink-0 mt-2">
                              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-16 text-center">
                      <div className="w-16 h-16 bg-bg-app rounded-full flex items-center justify-center mx-auto mb-4 text-border">
                        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                      </div>
                      <h3 className="text-lg font-bold text-navy mb-1" style={{ fontFamily: 'var(--font-heading)' }}>No Activities Scheduled</h3>
                      <p className="text-text-secondary text-sm max-w-sm mx-auto mb-6">
                        You don't have any training activities scheduled for {isToday ? 'today' : 'this date'}. Take it easy and recover!
                      </p>
                      <button
                        onClick={() => {
                          setEditingEntry(null);
                          setModalMode('session');
                        }}
                        className="px-5 py-2.5 bg-white border border-border shadow-sm rounded-lg text-sm font-bold text-navy hover:bg-bg-app transition-colors cursor-pointer"
                      >
                        + Log an Activity
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden shadow-sm relative bg-white">
            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 bg-navy">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className={`text-center text-[10px] font-bold uppercase tracking-widest py-3 ${i >= 5 ? 'text-white/70' : 'text-white'
                    }`}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="grid grid-cols-7"
                style={{ gap: '1px', backgroundColor: 'var(--color-border-light)' }}
              >
                {week.map((date, di) => {
                  const dateKey = formatDateKey(date);
                  const isToday = dateKey === today;
                  const isOutside = date.getMonth() !== currentMonthNum;
                  const dayEntries = entriesByDate[dateKey] || [];
                  const isRestDay = dayEntries.length === 1 && (dayEntries[0].workout_type === 'rest' || dayEntries[0].title?.toLowerCase() === 'rest');
                  const MAX_VISIBLE = 3;
                  const visibleEntries = isRestDay ? [] : dayEntries.slice(0, MAX_VISIBLE);
                  const moreCount = isRestDay ? 0 : Math.max(0, dayEntries.length - MAX_VISIBLE);
                  const hasEntries = dayEntries.length > 0;

                  return (
                    <motion.div
                      key={dateKey}
                      whileHover={{ backgroundColor: isToday ? '#EEF2FF' : '#F8FAFF' }}
                      onClick={() => handleDayClick(dateKey)}
                      className={`p-1.5 min-h-[100px] cursor-pointer flex flex-col transition-all relative ${isOutside
                        ? 'bg-bg-app/50'
                        : isToday
                          ? 'bg-blue-50/50'
                          : 'bg-white'
                        }`}
                      style={{ opacity: isOutside ? 0.35 : 1 }}
                    >
                      {/* Today left accent */}
                      {isToday && (
                        <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-navy" />
                      )}

                      {/* Date number */}
                      <div className="flex items-center justify-between mb-1 px-0.5">
                        <span
                          className={`inline-flex items-center justify-center font-mono text-xs font-semibold ${isToday
                            ? 'w-7 h-7 rounded-full bg-navy text-white shadow-sm'
                            : 'text-text-secondary'
                            }`}
                        >
                          {date.getDate()}
                        </span>
                        {isRestDay && !isOutside ? (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-gray-100 text-gray-500 uppercase tracking-widest">
                            Rest
                          </span>
                        ) : hasEntries && !isOutside && (
                          <span className="text-[9px] font-mono text-text-muted">
                            {dayEntries.length}
                          </span>
                        )}
                      </div>

                      {/* Entry mini cards */}
                      <div className="flex flex-col gap-1 flex-1">
                        {visibleEntries.map((entry) => (
                          <MiniCard key={entry.id} entry={entry} unit={unit} />
                        ))}
                        {moreCount > 0 && (
                          <span className="text-[10px] text-navy font-semibold pl-1.5 hover:underline">
                            +{moreCount} more
                          </span>
                        )}
                      </div>

                      {/* Empty day hover hint */}
                      {!hasEntries && !isOutside && (
                        <div className="flex-1 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="w-6 h-6 rounded-full border-2 border-dashed border-border flex items-center justify-center text-text-muted text-xs">
                            +
                          </span>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ))}

            {/* Loading overlay */}
            {loading && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center">
                <div className="flex items-center gap-2.5 bg-white rounded-xl px-4 py-3 shadow-md">
                  <svg className="w-4 h-4 animate-spin text-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span className="text-sm font-medium text-text-secondary">Loading...</span>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Day detail modal */}
      <DayDetailModal
        isOpen={!!selectedDate && !modalMode}
        onClose={() => setSelectedDate(null)}
        date={selectedDate}
        entries={entriesByDate[selectedDate] || []}
        onAddWorkout={handleAddWorkout}
        onLogActivity={handleLogActivity}
        onEditEntry={handleEditEntry}
        onMarkComplete={handleMarkComplete}
      />

      {/* Session details modal (create/edit) */}
      <SessionDetailsModal
        isOpen={modalMode === 'session'}
        onClose={() => {
          setModalMode(null);
          setEditingEntry(null);
        }}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
        entry={editingEntry}
        selectedDate={selectedDate}
      />

      {/* Manual activity modal */}
      <ManualActivityModal
        isOpen={modalMode === 'log'}
        onClose={() => setModalMode(null)}
        onSuccess={() => {
          setModalMode(null);
          fetchMonthEntries();
        }}
        defaultDate={selectedDate}
      />
    </div >
  );
};

export default Calendar;
