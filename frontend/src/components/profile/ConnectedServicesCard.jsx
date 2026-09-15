import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LuRefreshCw, LuUnlink, LuShieldCheck, LuBell, LuCircleCheckBig } from 'react-icons/lu';
import { stravaAPI } from '../../api/strava';
import { getErrorMessage } from '../../api/client';
import BrandIcon from '../BrandIcon';
import StatusBadge from '../ui/StatusBadge';

const DisconnectModal = ({ onConfirm, onCancel, loading }) => (
  <div
    className="fixed inset-0 z-[500] flex items-center justify-center bg-navy/50 px-4"
    onClick={onCancel}
  >
    <div
      className="w-full max-w-[440px] rounded-[20px] bg-white px-8 py-7 shadow-[0_20px_60px_rgba(27,37,89,0.25)]"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-lg font-bold text-navy mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
        Disconnect Strava?
      </h2>
      <p className="text-sm text-text-secondary mb-6 leading-relaxed">
        Your Strava activities will no longer sync. Existing activity data already imported into Korsana will not be removed.
      </p>
      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="btn btn-sm btn-outline" disabled={loading}>
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="btn btn-sm text-white border-none"
          style={{ background: 'var(--color-danger)' }}
        >
          {loading ? 'Disconnecting…' : 'Yes, Disconnect'}
        </button>
      </div>
    </div>
  </div>
);

const ConnectedServicesCard = ({
  stravaConnected,
  stravaAthleteId,
  syncing,
  syncMessage,
  onSync,
  integrationInterest = [],
  onConnectStrava,
  onDisconnect,
  onRequestIntegrationInterest,
}) => {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const [requestingSource, setRequestingSource] = useState('');
  const [interestMessage, setInterestMessage] = useState({ type: '', text: '' });

  const interestBySource = useMemo(
    () => Object.fromEntries((integrationInterest || []).map((item) => [item.source, item])),
    [integrationInterest],
  );

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      setDisconnectError('');
      await stravaAPI.disconnect();
      setConfirmDisconnect(false);
      if (onDisconnect) await onDisconnect();
    } catch (err) {
      setDisconnectError(getErrorMessage(err));
      setDisconnecting(false);
    }
  };

  const handleRequestInterest = async (source) => {
    if (!onRequestIntegrationInterest) return;

    try {
      setRequestingSource(source);
      setInterestMessage({ type: '', text: '' });
      const response = await onRequestIntegrationInterest(source);
      setInterestMessage({
        type: 'success',
        text: response?.message || `We'll keep you posted when ${source} opens up.`,
      });
    } catch (err) {
      setInterestMessage({ type: 'error', text: getErrorMessage(err) });
    } finally {
      setRequestingSource('');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <BrandIcon brand="strava" size={24} />
            <div>
              <h2 className="text-base font-bold text-navy" style={{ fontFamily: 'var(--font-heading)' }}>
                Strava
              </h2>
              <p className="text-xs text-text-muted">Running & activity tracking</p>
            </div>
          </div>
          <StatusBadge
            label={stravaConnected ? 'Connected' : 'Not connected'}
            variant={stravaConnected ? 'success' : 'neutral'}
            size="sm"
            dot
          />
        </div>

        <AnimatePresence>
          {syncMessage?.text && (
            <motion.div
              key="sync-msg"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-lg px-4 py-3 mb-4 text-sm font-medium text-white ${syncMessage.type === 'success' ? 'bg-success' : 'bg-error'}`}
            >
              {syncMessage.text}
            </motion.div>
          )}
          {disconnectError && (
            <motion.div
              key="error-msg"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-lg px-4 py-3 mb-4 text-sm font-medium text-white bg-error"
            >
              {disconnectError}
            </motion.div>
          )}
        </AnimatePresence>

        {stravaConnected ? (
          <div>
            <div className="bg-[var(--navy-tint)] rounded-xl p-4 mb-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <LuShieldCheck size={14} className="text-success shrink-0" />
                  <span>Read-only access to activities</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Athlete ID</span>
                <span className="text-xs font-mono text-text-secondary">#{stravaAthleteId}</span>
              </div>
            </div>

            <p className="text-sm text-text-secondary leading-relaxed mb-5">
              Activities sync automatically when you open the Dashboard. Use the button below to pull in the latest runs on demand.
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={onSync} disabled={syncing} className="btn btn-sm btn-outline font-semibold flex items-center gap-2">
                <LuRefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="btn btn-sm font-semibold text-text-secondary bg-border-light hover:text-error hover:bg-error/10 border-none transition-colors flex items-center gap-2"
              >
                <LuUnlink size={14} />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-text-secondary mb-5 leading-relaxed">
              Connect Strava to automatically sync your running activities and unlock personalized coaching based on your real training data.
            </p>
            <button
              onClick={onConnectStrava}
              className="btn btn-sm font-semibold text-white border-none flex items-center gap-2"
              style={{ background: 'var(--color-strava)' }}
            >
              <BrandIcon brand="strava" size={15} />
              Connect Strava
            </button>
          </div>
        )}
      </div>

      {interestMessage.text && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${interestMessage.type === 'success' ? 'bg-sage/10 border border-sage/30 text-navy' : 'bg-error text-white'}`}>
          {interestMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[
          {
            source: 'garmin',
            brand: 'garmin',
            name: 'Garmin Connect',
            desc: 'Register interest for Garmin sync and we will reach out when beta access opens.',
          },
          {
            source: 'coros',
            brand: 'coros',
            name: 'Coros',
            desc: 'Join the Coros queue so we can prioritize rollout based on real demand.',
          },
        ].map(({ source, brand, name, desc }) => {
          const requested = Boolean(interestBySource[source]);
          return (
            <div key={source} className="card relative overflow-hidden">
              <div className="absolute top-4 right-4">
                <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-1 rounded ${requested ? 'text-sage bg-sage/10' : 'text-text-muted bg-border-light'}`}>
                  {requested ? 'Requested' : 'Beta queue'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 mb-3 mt-1">
                <BrandIcon brand={brand} size={20} />
                <h3 className="font-semibold text-sm text-text-primary" style={{ fontFamily: 'var(--font-heading)' }}>
                  {name}
                </h3>
              </div>
              <p className="text-xs text-text-muted leading-relaxed mb-4">{desc}</p>
              <button
                onClick={() => handleRequestInterest(source)}
                disabled={requested || requestingSource === source}
                className={`btn btn-sm flex items-center gap-1.5 text-xs ${requested ? 'bg-sage/10 text-sage border border-sage/30 cursor-default' : 'btn-outline'}`}
              >
                {requested ? <LuCircleCheckBig size={12} /> : <LuBell size={12} />}
                {requested ? 'Requested' : requestingSource === source ? 'Saving…' : 'Request access'}
              </button>
            </div>
          );
        })}
      </div>

      {confirmDisconnect && (
        <DisconnectModal
          onConfirm={handleDisconnect}
          onCancel={() => {
            setConfirmDisconnect(false);
            setDisconnectError('');
          }}
          loading={disconnecting}
        />
      )}
    </div>
  );
};

export default ConnectedServicesCard;
