import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { userProfileAPI } from '../api/userProfile';
import { stravaAPI } from '../api/strava';
import { getErrorMessage } from '../api/client';
import { getStravaRedirectState, clearStravaRedirectParams } from '../lib/stravaRedirect';
import { useStravaSync } from '../hooks/useStravaSync';

import ProfileBanner from '../components/profile/ProfileBanner';
import PersonalRecords from '../components/profile/PersonalRecords';
import WeeklySummaryCard from '../components/profile/WeeklySummaryCard';
import TrainingZonesCard from '../components/profile/TrainingZonesCard';
import ConnectedServicesCard from '../components/profile/ConnectedServicesCard';
import ChangePasswordForm from '../components/profile/ChangePasswordForm';

import UnitsPreferenceCard from '../components/profile/UnitsPreferenceCard';
import TimezoneCard from '../components/profile/TimezoneCard';
import NotificationsCard from '../components/profile/NotificationsCard';
import DataExportCard from '../components/profile/DataExportCard';
import DeleteAccountCard from '../components/profile/DeleteAccountCard';
import ChangeEmailForm from '../components/profile/ChangeEmailForm';
import { PageSkeleton } from '../components/PageSkeleton';

const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('identity'); // 'identity' | 'performance' | 'integrations' | 'notifications' | 'account'
  const [generalError, setGeneralError] = useState('');

  const { syncing: stravaSyncing, syncMessage: stravaMessage, sync: syncStrava, showMessage: showStravaMessage } =
    useStravaSync({ onSuccess: () => fetchProfile() });

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const redirectState = getStravaRedirectState(searchParams);
    if (!redirectState) return;

    setActiveTab('integrations');
    clearStravaRedirectParams(setSearchParams);

    if (redirectState.type === 'success') {
      showStravaMessage('Strava connected. Pulling in your latest activities...', 'success', 5000);
      syncStrava({ afterConnect: true });
      return;
    }

    showStravaMessage(redirectState.text, 'error', 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setGeneralError('');
      const data = await userProfileAPI.getFullProfile();
      setProfileData(data);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
      setGeneralError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async () => {
    await fetchProfile(); // Re-fetch the data to reflect changes
  };

  const handleIntegrationInterest = async (source) => {
    const response = await userProfileAPI.requestIntegrationInterest(source);
    await fetchProfile();
    return response;
  };

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="pb-12">
      {generalError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-error text-white text-sm rounded-lg px-4 py-3 mb-6"
        >
          {generalError}
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-6 border-b border-border my-8">
        {[
          { key: 'identity',     label: 'Identity' },
          { key: 'performance',  label: 'Performance' },
          { key: 'integrations', label: 'Integrations' },
          { key: 'notifications',label: 'Notifications' },
          { key: 'account',      label: 'Account & Security' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`pb-3 text-[0.9375rem] font-semibold transition-colors relative ${activeTab === key ? 'text-navy' : 'text-text-muted hover:text-text-secondary'}`}
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {label}
            {activeTab === key && (
              <motion.div
                layoutId="settingsTabIndicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-navy"
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">

        {/* ── Identity ── */}
        {activeTab === 'identity' && (
          <motion.div
            key="identity"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-8"
          >
            <ProfileBanner profileData={profileData} onUpdate={handleProfileUpdate} />
            <UnitsPreferenceCard profileData={profileData} onUpdate={handleProfileUpdate} />
            <TimezoneCard profileData={profileData} onUpdate={handleProfileUpdate} />
          </motion.div>
        )}

        {/* ── Performance Profile ── */}
        {activeTab === 'performance' && (
          <motion.div
            key="performance"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-8"
          >
            <PersonalRecords profileData={profileData} onUpdate={handleProfileUpdate} />
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              <div className="md:col-span-2">
                <WeeklySummaryCard profileData={profileData} onUpdate={handleProfileUpdate} />
              </div>
              <div className="md:col-span-3">
                <TrainingZonesCard profileData={profileData} onUpdate={handleProfileUpdate} />
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Integrations ── */}
        {activeTab === 'integrations' && (
          <motion.div
            key="integrations"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-8"
          >
            <ConnectedServicesCard
              stravaConnected={profileData?.strava?.connected}
              stravaAthleteId={profileData?.strava?.athlete_id}
              syncing={stravaSyncing}
              syncMessage={stravaMessage}
              onSync={() => syncStrava()}
              integrationInterest={profileData?.integration_interest}
              onConnectStrava={async () => {
                try {
                  const response = await stravaAPI.getAuthURL();
                  window.location.href = response.url;
                } catch (error) {
                  showStravaMessage(getErrorMessage(error), 'error', 5000);
                }
              }}
              onDisconnect={handleProfileUpdate}
              onRequestIntegrationInterest={handleIntegrationInterest}
            />
          </motion.div>
        )}

        {/* ── Notifications ── */}
        {activeTab === 'notifications' && (
          <motion.div
            key="notifications"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-8"
          >
            <NotificationsCard profileData={profileData} onUpdate={handleProfileUpdate} />
          </motion.div>
        )}

        {/* ── Account & Security ── */}
        {activeTab === 'account' && (
          <motion.div
            key="account"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-8"
          >
            {/* Account details */}
            <div className="card">
              <h2 className="text-base font-bold text-navy mb-5" style={{ fontFamily: 'var(--font-heading)' }}>
                Account Details
              </h2>
              <div className="divide-y divide-border">
                {[
                  { label: 'Email',        value: profileData?.user?.email },
                  { label: 'Member since', value: profileData?.user?.created_at
                    ? new Date(profileData.user.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : '—' },
                  { label: 'User ID',      value: profileData?.user?.id
                    ? `${profileData.user.id.slice(0, 8)}…`
                    : '—', mono: true },
                ].map(({ label, value, mono }) => (
                  <div key={label} className="flex items-center justify-between py-3 gap-4">
                    <span className="text-sm text-text-secondary shrink-0">{label}</span>
                    <span className={`text-sm font-medium text-right ${mono ? 'font-mono text-text-muted' : ''}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <ChangeEmailForm />
            <ChangePasswordForm />
            <DataExportCard />
            <DeleteAccountCard />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default Settings;
