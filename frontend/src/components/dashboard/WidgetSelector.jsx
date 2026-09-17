import { useState } from 'react';
import { WIDGETS } from '../../lib/dashboardConstants';

const WidgetSelector = ({ active, toggle }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-[6px] border rounded-lg px-3 py-[5px] font-sans text-[11px] font-bold text-navy cursor-pointer transition-all"
        style={{
          background: open ? 'rgba(27,37,89,0.08)' : '#F8F9FC',
          borderColor: open ? '#1B2559' : '#D4D8E8',
        }}
      >
        Customize
        <span className="font-mono text-[10px] bg-coral text-white rounded-full px-[6px] py-[1px]">
          {active.length}
        </span>
        <span
          className="text-[11px] text-[var(--color-text-muted)] inline-block transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[299]" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+8px)] right-0 bg-white rounded-[14px] w-[320px] border border-[var(--color-border-light)] px-[14px] pt-[14px] pb-[10px] z-[300] shadow-[0_4px_32px_rgba(27,37,89,0.16)]">
            <div className="font-sans text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em] mb-[10px]">
              Customize your widgets
            </div>
            <div className="grid grid-cols-3 gap-[6px]">
              {WIDGETS.map(w => {
                const on = active.includes(w.id);
                return (
                  <button
                    key={w.id}
                    onClick={() => toggle(w.id)}
                    className="rounded-[9px] px-[6px] py-2 flex flex-col items-center gap-[3px] cursor-pointer transition-all border-[1.5px]"
                    style={{
                      background: on ? '#1B2559' : '#F8F9FC',
                      borderColor: on ? '#1B2559' : '#ECEEF4',
                    }}
                  >
                    <w.Icon size={14} />
                    <span
                      className="font-sans text-[10px] font-bold"
                      style={{ color: on ? '#ffffff' : '#4A5173' }}
                    >{w.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-[10px] pt-[10px] border-t border-[var(--color-border-light)] flex justify-between">
              <button
                onClick={() => WIDGETS.forEach(w => !active.includes(w.id) && toggle(w.id))}
                className="font-sans text-[11px] font-semibold text-navy bg-transparent border-0 cursor-pointer"
              >Show all</button>
              <button
                onClick={() => [...active].forEach(id => toggle(id))}
                className="font-sans text-[11px] font-semibold text-[var(--color-text-muted)] bg-transparent border-0 cursor-pointer"
              >Clear</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WidgetSelector;
