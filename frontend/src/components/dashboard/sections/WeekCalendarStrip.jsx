import { Link } from 'react-router-dom';
import { WC } from '../../../lib/dashboardConstants';
import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';

const WeekCalendarStrip = ({ calendarStrip, unitLabel }) => (
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
);

export default WeekCalendarStrip;
