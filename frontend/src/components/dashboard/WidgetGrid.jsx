import { memo } from 'react';
import ErrorBoundary from '../ErrorBoundary';
import SLabel from './atoms/SLabel';
import TrainingLoadWidget from './widgets/TrainingLoadWidget';
import RacePredictorWidget from './widgets/RacePredictorWidget';
import LongRunConfidenceWidget from './widgets/LongRunConfidenceWidget';
import RecoveryWidget from './widgets/RecoveryWidget';
import InjuryRiskWidget from './widgets/InjuryRiskWidget';
import HRZonesWidget from './widgets/HRZonesWidget';
import ElevationWidget from './widgets/ElevationWidget';
import CadenceWidget from './widgets/CadenceWidget';
import StreakWidget from './widgets/StreakWidget';
import CrossTrainingWidget from './widgets/CrossTrainingWidget';
import ExecutionScoreWidget from './widgets/ExecutionScoreWidget';
import ShoeWidget from './widgets/ShoeWidget';
import CardiacDriftWidget from './widgets/CardiacDriftWidget';
import CaloriesWidget from './widgets/CaloriesWidget';

const WidgetGrid = memo(({ active, dashboardData, computedData, onRefresh, stravaConnected, onConnect }) => {
  if (!active.length) return null;
  const has = (id) => active.includes(id);
  const stravaProps = { stravaConnected, onConnect };
  return (
    <div className="flex flex-col gap-8">

      {/* ── Readiness ── */}
      {(has('load') || has('recovery') || has('injuryrisk')) && (
        <section>
          <SLabel>Readiness</SLabel>
          <div className="flex flex-col gap-5">
            {has('load') && (
              <ErrorBoundary name="Training Load">
                <TrainingLoadWidget data={dashboardData?.training_load} {...stravaProps} />
              </ErrorBoundary>
            )}
            {(has('recovery') || has('injuryrisk')) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {has('recovery') && (
                  <ErrorBoundary name="Recovery">
                    <RecoveryWidget data={dashboardData?.recovery} {...stravaProps} />
                  </ErrorBoundary>
                )}
                {has('injuryrisk') && (
                  <ErrorBoundary name="Injury Risk">
                    <InjuryRiskWidget data={dashboardData?.injury_risk} {...stravaProps} />
                  </ErrorBoundary>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Performance ── */}
      {(has('predictor') || has('longrun') || has('hrzones')) && (
        <section>
          <SLabel>Performance</SLabel>
          <div className="flex flex-col gap-5">
            {has('predictor') && (
              <ErrorBoundary name="Race Predictor">
                <RacePredictorWidget data={dashboardData?.predictor} onRefresh={onRefresh} {...stravaProps} />
              </ErrorBoundary>
            )}
            {(has('longrun') || has('hrzones')) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {has('longrun') && (
                  <ErrorBoundary name="Long Run">
                    <LongRunConfidenceWidget data={dashboardData?.long_run} {...stravaProps} />
                  </ErrorBoundary>
                )}
                {has('hrzones') && (
                  <ErrorBoundary name="HR Zones">
                    <HRZonesWidget data={dashboardData?.hr_zones} {...stravaProps} />
                  </ErrorBoundary>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Durability ── */}
      {(has('elevation') || has('cadence') || has('streak')) && (
        <section>
          <SLabel>Durability</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {has('elevation') && (
              <ErrorBoundary name="Elevation">
                <ElevationWidget data={computedData?.elevation} {...stravaProps} />
              </ErrorBoundary>
            )}
            {has('cadence') && (
              <ErrorBoundary name="Cadence">
                <CadenceWidget data={computedData?.cadence} {...stravaProps} />
              </ErrorBoundary>
            )}
            {has('streak') && (
              <ErrorBoundary name="Streak">
                <StreakWidget data={computedData?.streak} {...stravaProps} />
              </ErrorBoundary>
            )}
          </div>
        </section>
      )}

      {/* ── Execution ── */}
      {(has('execution') || has('calories')) && (
        <section>
          <SLabel>Execution</SLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {has('execution') && (
              <ErrorBoundary name="Execution Score">
                <ExecutionScoreWidget data={dashboardData?.execution} />
              </ErrorBoundary>
            )}
            {has('calories') && (
              <ErrorBoundary name="Calories">
                <CaloriesWidget data={computedData?.calories} {...stravaProps} />
              </ErrorBoundary>
            )}
          </div>
        </section>
      )}

      {/* ── Support ── */}
      {(has('crosstraining') || has('shoes') || has('cardiac')) && (
        <section>
          <SLabel>Support</SLabel>
          <div className="flex flex-col gap-5">
            {has('crosstraining') && (
              <ErrorBoundary name="Cross-Training">
                <CrossTrainingWidget data={dashboardData?.cross_training} onRefresh={onRefresh} />
              </ErrorBoundary>
            )}
            {(has('shoes') || has('cardiac')) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {has('shoes') && (
                  <ErrorBoundary name="Shoes">
                    <ShoeWidget data={dashboardData?.shoes} onRefresh={onRefresh} />
                  </ErrorBoundary>
                )}
                {has('cardiac') && (
                  <ErrorBoundary name="Cardiac Drift">
                    <CardiacDriftWidget />
                  </ErrorBoundary>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
});

export default WidgetGrid;
