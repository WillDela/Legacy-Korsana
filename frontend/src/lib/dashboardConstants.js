import {
  LuChartColumnBig as LuBarChart2, LuTarget, LuActivity, LuHeart, LuZap, LuHeartPulse,
  LuMountain, LuFootprints, LuFlame, LuDumbbell, LuCircleCheckBig as LuCheckCircle2,
  LuTrendingUp,
} from 'react-icons/lu';

// ─── Workout type colors ───────────────────────────────────────
export const WC = {
  easy:          { bg: '#E8F0FE', text: '#2A3A7C' },
  Easy:          { bg: '#E8F0FE', text: '#2A3A7C' },
  long:          { bg: '#1B2559', text: '#FFFFFF' },
  'Long Run':    { bg: '#1B2559', text: '#FFFFFF' },
  Long:          { bg: '#1B2559', text: '#FFFFFF' },
  tempo:         { bg: '#FDE8E3', text: '#C0391B' },
  Tempo:         { bg: '#FDE8E3', text: '#C0391B' },
  interval:      { bg: '#FFF3CD', text: '#856404' },
  Intervals:     { bg: '#FFF3CD', text: '#856404' },
  rest:          { bg: '#ECEEF4', text: '#8B93B0' },
  Rest:          { bg: '#ECEEF4', text: '#8B93B0' },
  cross_train:   { bg: '#F1F5F9', text: '#475569' },
  'Cross Train': { bg: '#F1F5F9', text: '#475569' },
  cycling:       { bg: '#E0F2FE', text: '#0369A1' },
  swimming:      { bg: '#CFFAFE', text: '#0E7490' },
  lifting:       { bg: '#EDE9FE', text: '#6D28D9' },
  walking:       { bg: '#DCFCE7', text: '#15803D' },
  recovery:      { bg: '#F1F5F9', text: '#475569' },
  Recovery:      { bg: '#F1F5F9', text: '#475569' },
};

// ─── Training phase config ─────────────────────────────────────
export const PHASE_VARIANT = { Build: 'info', Peak: 'coral', Taper: 'success', 'Race Week': 'warning' };

export const WIDGETS = [
  { id: 'load',          label: 'Training Load',  Icon: LuBarChart2 },
  { id: 'predictor',     label: 'Race Predictor', Icon: LuTarget },
  { id: 'longrun',       label: 'Long Run',       Icon: LuActivity },
  { id: 'recovery',      label: 'Recovery',       Icon: LuHeart },
  { id: 'injuryrisk',    label: 'Injury Risk',    Icon: LuZap },
  { id: 'hrzones',       label: 'HR Zones',       Icon: LuHeartPulse },
  { id: 'elevation',     label: 'Elevation',      Icon: LuMountain },
  { id: 'cadence',       label: 'Cadence',        Icon: LuFootprints },
  { id: 'streak',        label: 'Streak',         Icon: LuFlame },
  { id: 'crosstraining', label: 'Cross-Training', Icon: LuDumbbell },
  { id: 'execution',     label: 'Exec Score',     Icon: LuCheckCircle2 },
  { id: 'shoes',         label: 'Shoes',          Icon: LuFootprints },
  { id: 'cardiac',       label: 'Cardiac Drift',  Icon: LuTrendingUp },
  { id: 'calories',      label: 'Calories',       Icon: LuFlame },
];

export const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const RUN_TABLE_COLS = '100px 100px 2fr 1fr 1fr 1fr 1fr';
export const RUN_TABLE_HEADERS = ['Date', 'Type', 'Distance', 'Pace', 'Time', 'HR', 'Elev'];
