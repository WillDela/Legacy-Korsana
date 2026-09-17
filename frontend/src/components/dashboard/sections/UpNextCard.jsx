import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';
import Pill from '../atoms/Pill';

const UpNextCard = ({ entries, unitLabel }) => {
  if (!entries.length) return null;
  return (
    <Card>
      <SLabel>Up Next</SLabel>
      {entries.map((d, i) => (
        <div
          key={i}
          className="flex items-center gap-[14px] py-3"
          style={{ borderBottom: i < entries.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}
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
  );
};

export default UpNextCard;
