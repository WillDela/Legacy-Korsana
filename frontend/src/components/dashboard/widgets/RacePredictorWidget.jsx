import { useState } from 'react';
import { predictorAPI } from '../../../api/dashboard';
import DataEmptyState from '../../ui/DataEmptyState';
import { fmtTime } from '../../../lib/dashboardHelpers';

const inputClass = 'px-[10px] py-2 rounded-lg border border-[var(--color-border-light)] font-sans text-[12px] box-border';

export default function RacePredictorWidget({ data, onRefresh, stravaConnected, onConnect }) {
  const [showModal, setShowModal] = useState(false);
  const [editDist, setEditDist] = useState('10K');
  const [editH, setEditH] = useState('0');
  const [editM, setEditM] = useState('45');
  const [editS, setEditS] = useState('00');
  const [editDate, setEditDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  if (!data) {
    return (
      <div className="widget-card">
        <div className="flex justify-between mb-4">
          <span className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">Race Predictor</span>
          <span className="font-sans text-[9px] font-bold text-coral">✦ Korsana</span>
        </div>
        <DataEmptyState
          variant={stravaConnected === false ? 'strava' : 'nodata'}
          title={stravaConnected === false ? 'Connect Strava' : 'No predictions yet'}
          description={stravaConnected === false ? 'Connect to see your race predictions' : 'Sync activities to get started'}
          action={stravaConnected === false ? { label: 'Connect Strava', onClick: onConnect } : undefined}
        />
      </div>
    );
  }

  const marathon = data.predictions?.find(p => p.label === 'Marathon');
  const goalSecs = data.goal_seconds;

  const handleSave = async () => {
    setSaving(true);
    try {
      const totalSecs = parseInt(editH) * 3600 + parseInt(editM) * 60 + parseInt(editS);
      await predictorAPI.saveManual({
        distance_label: editDist === 'Half Marathon'
          ? 'half_marathon'
          : editDist.toLowerCase().replace(' ', ''),
        time_seconds: totalSecs,
        date_recorded: editDate,
      });
      setShowModal(false);
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="widget-card">
      <div className="flex justify-between mb-4">
        <span className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
          Race Predictor
        </span>
        <span className="font-sans text-[9px] font-bold text-coral">✦ Korsana</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 160px', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="font-sans text-[10px] text-[var(--color-text-muted)] mb-1">Based on</div>
          <div className="font-mono text-[14px] font-bold text-navy">{data.source_distance}</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-[2px]">
            {fmtTime(data.source_time_seconds)}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="mt-[10px] bg-transparent border-0 font-sans text-[11px] text-coral cursor-pointer p-0 font-semibold"
          >
            Edit →
          </button>
        </div>
        <div className="text-center">
          <div className="font-sans text-[10px] text-[var(--color-text-muted)] mb-1">
            Marathon Prediction
          </div>
          <div className="font-mono text-[48px] font-bold text-navy leading-none">
            {fmtTime(marathon?.seconds)}
          </div>
          {marathon && (
            <div className="font-sans text-[10px] text-[var(--color-text-muted)] mt-1">
              {fmtTime(marathon.low)} – {fmtTime(marathon.high)}
            </div>
          )}
          {goalSecs && marathon && (
            <div
              className="mt-2 font-sans text-[11px] font-semibold"
              style={{ color: marathon.seconds <= goalSecs ? '#2ECC8B' : '#E8634A' }}
            >
              {marathon.seconds <= goalSecs
                ? '✓ On track for goal'
                : `${fmtTime(marathon.seconds - goalSecs)} behind goal`}
            </div>
          )}
        </div>
        <div>
          {(data.predictions || []).map((p, i) => (
            <div
              key={i}
              className="flex justify-between py-[7px]"
              style={{
                borderBottom: i < data.predictions.length - 1
                  ? '1px solid var(--color-border-light)' : 'none',
                background: p.label === 'Marathon' ? 'var(--color-bg-elevated)' : 'transparent',
                borderRadius: p.label === 'Marathon' ? 6 : 0,
                paddingLeft: p.label === 'Marathon' ? 6 : 0,
              }}
            >
              <span className="font-sans text-[11px] text-[var(--color-text-secondary)]">{p.label}</span>
              <span className="font-mono text-[12px] font-bold text-navy">{fmtTime(p.seconds)}</span>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <>
          <div
            className="fixed inset-0 bg-black/35 z-[1000]"
            onClick={() => setShowModal(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-[18px] px-8 py-7 z-[1001] w-[360px] shadow-[0_8px_40px_rgba(27,37,89,0.2)]">
            <div className="font-sans text-[14px] font-bold text-navy mb-5">Set Race Time</div>
            <label className="font-sans text-[11px] text-[var(--color-text-muted)] block mb-1">
              Distance
            </label>
            <select
              value={editDist}
              onChange={e => setEditDist(e.target.value)}
              className={`${inputClass} w-full mb-[14px]`}
            >
              {['5K', '10K', 'Half Marathon', 'Marathon'].map(d => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <label className="font-sans text-[11px] text-[var(--color-text-muted)] block mb-1">
              Time (H:MM:SS)
            </label>
            <div className="flex gap-2 mb-[14px]">
              {[
                { val: editH, set: setEditH, min: 0, max: 9, ph: 'H' },
                { val: editM, set: setEditM, min: 0, max: 59, ph: 'MM' },
                { val: editS, set: setEditS, min: 0, max: 59, ph: 'SS' },
              ].map(({ val, set, min, max, ph }) => (
                <input
                  key={ph}
                  type="number"
                  min={min}
                  max={max}
                  value={val}
                  onChange={e => set(e.target.value)}
                  placeholder={ph}
                  className="w-1/3 px-2 py-2 rounded-lg border border-[var(--color-border-light)] font-mono text-[14px] text-center box-border"
                />
              ))}
            </div>
            <label className="font-sans text-[11px] text-[var(--color-text-muted)] block mb-1">
              Date Recorded
            </label>
            <input
              type="date"
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
              className={`${inputClass} w-full mb-5`}
            />
            <div className="flex gap-[10px]">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-[10px] rounded-[10px] border border-[var(--color-border-light)] bg-[var(--color-bg-elevated)] font-sans text-[12px] font-semibold text-[var(--color-text-secondary)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] py-[10px] rounded-[10px] border-0 bg-navy font-sans text-[12px] font-bold text-white cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
