import { LuCheck } from 'react-icons/lu';
import { getWorkoutSegments } from '../../../lib/dashboardHelpers';
import SLabel from '../atoms/SLabel';

const TodayWorkoutCard = ({ todayEntries, unit, unitLabel, MPU, onMarkDone, onPlanWorkout }) => (
  <div>
    <SLabel>Today's Workout</SLabel>
    {todayEntries.length > 0 ? (
      <div className="flex flex-col gap-4">
        {todayEntries.map(entry => {
          const entryDist = entry.distance_km
            ? parseFloat((entry.distance_km * 1000 / MPU).toFixed(1))
            : null;
          const entryType  = entry.workout_type || null;
          const isCrossTrain = entryType === 'cross_train';
          const entryHeading = entryType === 'Rest' || entryType === 'rest' ? 'Rest Day'
            : isCrossTrain ? (entry.title || 'Cross Training')
            : entryDist ? `${entryDist} ${unitLabel} ${entryType}`
            : (entry.title || entryType || 'Workout');
          const showSubtitle = !isCrossTrain && entry.title && entryHeading !== entry.title;
          const segments = entryType ? getWorkoutSegments(entryType, entryDist, unit) : null;
          return (
            <div key={entry.id} className="bg-navy rounded-2xl overflow-hidden relative shadow-[0_6px_24px_rgba(27,37,89,0.15)]">
              <div className="absolute left-0 top-0 bottom-0 w-[6px] bg-coral" />
              <div className="absolute right-[-20px] top-[-20px] opacity-5 pointer-events-none">
                <svg width="200" height="200" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeWidth="20" />
                </svg>
              </div>
              <div className="p-6 pl-[30px] relative z-[1]">
                <div className={`flex justify-between items-start ${segments ? 'mb-5' : ''}`}>
                  <div>
                    <div className="flex items-center gap-[10px] mb-2">
                      <span className="font-sans text-[13px] font-bold text-white/60 uppercase tracking-[0.1em]">
                        {new Date().toLocaleDateString('en-US', { weekday: 'long' })}
                      </span>
                      {entry.status === 'completed' && (
                        <span className="bg-[rgba(46,204,139,0.15)] text-[#2ECC8B] rounded-[5px] px-2 py-[3px] text-[10px] font-sans font-bold uppercase tracking-[0.05em]">
                          Done
                        </span>
                      )}
                    </div>
                    <div className="font-heading text-[26px] font-bold text-white leading-[1.1]">
                      {entryHeading}
                    </div>
                    {showSubtitle && (
                      <div className="font-sans text-[14px] text-white/70 leading-relaxed mt-[10px]">
                        {entry.title}
                      </div>
                    )}
                  </div>
                  {entry.status !== 'completed' && (
                    <div className="flex flex-col gap-2 items-end">
                      <button
                        onClick={() => onMarkDone(entry.id)}
                        className="bg-[#2ECC8B] text-white border-0 rounded-lg px-4 py-2 font-sans text-[13px] font-semibold cursor-pointer flex items-center gap-[6px]"
                      >
                        <LuCheck size={14} /> Mark Done
                      </button>
                      <button
                        onClick={onPlanWorkout}
                        className="bg-white/10 text-white border border-white/20 rounded-lg px-4 py-2 font-sans text-[13px] font-semibold cursor-pointer"
                      >
                        Plan Activity
                      </button>
                    </div>
                  )}
                </div>
                {segments && segments.length > 0 && (
                  <div className="bg-white/[0.06] rounded-xl p-4 border border-white/[0.08]">
                    <div className="font-sans text-[11px] font-bold text-white/40 uppercase tracking-[0.05em] mb-3">
                      Workout Structure
                    </div>
                    <div className="flex flex-col gap-2">
                      {segments.map((seg, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ background: seg.name === 'Warm-up' || seg.name === 'Cool-down' ? 'rgba(255,255,255,0.2)' : '#E8634A' }}
                          />
                          <div className="font-mono text-[14px] font-bold text-white w-[60px]">{seg.name}</div>
                          <div className="font-sans text-[13px] text-white/70">{seg.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="bg-white/50 rounded-2xl border border-dashed border-[#D4D8E8] h-[140px] flex items-center justify-center">
        <div className="font-sans text-[14px] text-[var(--color-text-muted)]">No workout scheduled for today</div>
      </div>
    )}
  </div>
);

export default TodayWorkoutCard;
