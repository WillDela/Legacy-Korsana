const Tip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-navy rounded-[10px] px-3 py-2">
      <div className="font-sans text-[10px] text-white/45 mb-[2px]">{label}</div>
      <div className="font-mono text-[13px] font-bold text-white">{payload[0]?.value}{unit}</div>
    </div>
  );
};

export default Tip;
