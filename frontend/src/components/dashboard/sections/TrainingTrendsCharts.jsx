import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { LuCheck } from 'react-icons/lu';
import { chartTheme } from '../../../lib/chartTheme';
import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';
import Tip from '../atoms/Tip';

const TrainingTrendsCharts = ({ weeklyChartData, unitLabel, effortDist }) => (
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
);

export default TrainingTrendsCharts;
