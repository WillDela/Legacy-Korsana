import { WC } from '../../../lib/dashboardConstants';

const Pill = ({ type, sm = false }) => {
  const s = WC[type] || WC.Easy;
  return (
    <span
      className={`font-sans font-bold uppercase tracking-[0.05em] whitespace-nowrap rounded-[5px] ${sm ? 'text-[9px] px-[7px] py-[2px]' : 'text-[11px] px-[9px] py-[3px]'}`}
      style={{ background: s.bg, color: s.text }}
    >
      {type}
    </span>
  );
};

export default Pill;
