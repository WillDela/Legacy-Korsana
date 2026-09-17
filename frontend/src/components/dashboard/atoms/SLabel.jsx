const SLabel = ({ children, action }) => (
  <div className="flex justify-between items-center mb-[14px]">
    <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
      {children}
    </div>
    {action}
  </div>
);

export default SLabel;
