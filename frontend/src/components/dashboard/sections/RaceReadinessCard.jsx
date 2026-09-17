import { useState } from 'react';
import Card from '../atoms/Card';
import SLabel from '../atoms/SLabel';
import Gauge from '../atoms/Gauge';

const RaceReadinessCard = ({ score, label, color, factors }) => {
  const [showFactors, setShowFactors] = useState(false);
  return (
    <Card>
      <SLabel>Race Readiness</SLabel>
      <div className="flex items-center gap-4 mb-4">
        <Gauge score={score} />
        <div>
          <div
            className="font-heading text-[22px] font-bold mb-1 tracking-[-0.01em] leading-[1.1]"
            style={{ color }}
          >{label}</div>
          <p className="font-sans text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            {score >= 70
              ? 'Strong base. Stay consistent and taper well.'
              : score >= 50
                ? 'Good progress. Keep building your long run and weekly volume.'
                : 'Focus on consistency and gradual mileage increases.'}
          </p>
        </div>
      </div>
      <button
        onClick={() => setShowFactors(!showFactors)}
        className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-light)] rounded-[10px] py-[10px] font-sans text-[12px] font-bold text-[var(--color-text-secondary)] cursor-pointer flex items-center justify-center gap-[6px]"
      >
        {showFactors ? 'Hide' : 'Show'} breakdown
        <span
          className="inline-block transition-transform duration-300"
          style={{ transform: showFactors ? 'rotate(180deg)' : 'none' }}
        >▾</span>
      </button>
      {showFactors && (
        <div className="mt-[14px] flex flex-col gap-[10px]">
          {Object.entries(factors).filter(([k]) => k !== 'composite').map(([name, factorScore]) => (
            <div key={name}>
              <div className="flex justify-between mb-[5px]">
                <span className="font-sans text-[12px] font-semibold text-[var(--color-text-secondary)]">{name}</span>
                <span
                  className="font-mono text-[13px] font-bold"
                  style={{ color: factorScore >= 70 ? '#2ECC8B' : factorScore >= 50 ? '#F5A623' : '#E84A4A' }}
                >{factorScore}</span>
              </div>
              <div className="h-[6px] bg-[var(--color-border-light)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${factorScore}%`,
                    background: factorScore >= 70 ? '#2ECC8B' : factorScore >= 50 ? '#F5A623' : '#E84A4A',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default RaceReadinessCard;
