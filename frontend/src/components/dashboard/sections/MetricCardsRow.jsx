import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';
import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';

const MetricCardsRow = ({
  weeklyMileage,
  weeklyTarget,
  unitLabel,
  weeklyMilageDelta,
  aerobicEffImprovement,
  aerobicEffData,
  trainingLoadScore,
  trainingLoadLabel,
  weeklyRunCount,
}) => (
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
);

export default MetricCardsRow;
