const Gauge = ({ score }) => {
  const color = score >= 70 ? '#2ECC8B' : score >= 50 ? '#F5A623' : '#E84A4A';
  const r = 48, circ = 2 * Math.PI * r;
  return (
    <div className="relative w-[120px] h-[120px] shrink-0">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ECEEF4" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[28px] font-bold text-navy leading-none">{score}</span>
        <span className="font-sans text-[10px] text-[var(--color-text-muted)]">/ 100</span>
      </div>
    </div>
  );
};

export default Gauge;
