import { RUN_TABLE_COLS, RUN_TABLE_HEADERS } from '../../../lib/dashboardConstants';
import { fmtTime } from '../../../lib/dashboardHelpers';
import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';
import Pill from '../atoms/Pill';

const RecentRunsTable = ({ recentRuns, MPU, unitLabel, fmtPace }) => (
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
);

export default RecentRunsTable;
