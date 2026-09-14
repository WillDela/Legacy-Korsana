package services

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/korsana/backend/internal/database"
	"github.com/korsana/backend/internal/logger"
	"github.com/korsana/backend/internal/models"
	"github.com/korsana/backend/pkg/strava"
)

// stravaQuerier is the subset of database methods StravaService needs.
// *database.DB satisfies this interface via its embedded *sqlx.DB.
type stravaQuerier interface {
	GetContext(ctx context.Context, dest any, query string, args ...any) error
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	NamedQueryContext(ctx context.Context, query string, arg any) (*sqlx.Rows, error)
	SelectContext(ctx context.Context, dest any, query string, args ...any) error
}

type stravaClient interface {
	GetAuthorizationURL(state string) string
	ExchangeToken(code string) (*strava.TokenResponse, error)
	RefreshToken(ctx context.Context, refreshToken string) (*strava.TokenResponse, error)
	GetActivities(ctx context.Context, accessToken string, page int, perPage int) ([]strava.Activity, error)
}

type stravaSyncPolicy struct {
	Mode     string
	MaxPages int
	PerPage  int
}

type StravaSyncResult struct {
	Count        int    `json:"count"`
	Status       string `json:"status"`
	Message      string `json:"message"`
	Partial      bool   `json:"partial"`
	PagesFetched int    `json:"pages_fetched,omitempty"`
}

const (
	stravaInitialSyncMaxPages   = 4
	stravaRecurringSyncMaxPages = 2
	stravaSyncPerPage           = 50
	stravaRateLimitMaxRetries   = 2
	stravaRateLimitBaseBackoff  = 2 * time.Second
	stravaRateLimitMaxBackoff   = 8 * time.Second
)

var (
	// ErrStravaRateLimited is returned when Strava replies with a 429.
	ErrStravaRateLimited = errors.New("strava sync is temporarily rate limited")

	// ErrStravaConnectionNotFound is returned when the user has no Strava
	// connection on record (or the lookup failed in a way that's
	// indistinguishable from absence).
	ErrStravaConnectionNotFound = errors.New("strava connection not found")
)

// StravaService handles Strava business logic
type StravaService struct {
	db           stravaQuerier
	stravaClient stravaClient
	redis        *redis.Client
	calendarSvc  *CalendarService
	refreshGroup singleflight.Group
}

// NewStravaService creates a new Strava service
func NewStravaService(db *database.DB, client *strava.Client, redisClient *redis.Client, calendarService *CalendarService) *StravaService {
	return &StravaService{
		db:           db,
		stravaClient: client,
		redis:        redisClient,
		calendarSvc:  calendarService,
	}
}

func syncPolicyForHistory(hasExistingActivities bool) stravaSyncPolicy {
	if hasExistingActivities {
		return stravaSyncPolicy{
			Mode:     "incremental",
			MaxPages: stravaRecurringSyncMaxPages,
			PerPage:  stravaSyncPerPage,
		}
	}
	return stravaSyncPolicy{
		Mode:     "initial_backfill",
		MaxPages: stravaInitialSyncMaxPages,
		PerPage:  stravaSyncPerPage,
	}
}

// GenerateOAuthState creates a secure random state parameter and stores it in Redis.
// returnTo is an optional frontend path (e.g. "/dashboard") to redirect to after connect.
func (s *StravaService) GenerateOAuthState(ctx context.Context, userID uuid.UUID, returnTo string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	state := hex.EncodeToString(b)

	// Value format: "userID|returnTo" (returnTo may be empty)
	value := userID.String() + "|" + returnTo
	key := fmt.Sprintf("strava_oauth_state:%s", state)
	if err := s.redis.Set(ctx, key, value, 10*time.Minute).Err(); err != nil {
		return "", err
	}

	return state, nil
}

// ValidateOAuthState validates the state parameter and returns the user ID and optional returnTo path.
func (s *StravaService) ValidateOAuthState(ctx context.Context, state string) (uuid.UUID, string, error) {
	key := fmt.Sprintf("strava_oauth_state:%s", state)
	val, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		return uuid.Nil, "", errors.New("invalid or expired state")
	}

	// Delete the state (one-time use)
	s.redis.Del(ctx, key)

	parts := strings.SplitN(val, "|", 2)
	userID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, "", errors.New("invalid user ID in state")
	}

	returnTo := ""
	if len(parts) > 1 {
		returnTo = parts[1]
	}

	return userID, returnTo, nil
}

// GenerateLoginOAuthState creates a state for the unauthenticated Strava login flow.
func (s *StravaService) GenerateLoginOAuthState(ctx context.Context) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	state := hex.EncodeToString(b)

	key := fmt.Sprintf("strava_login_state:%s", state)
	err := s.redis.Set(ctx, key, "login", 10*time.Minute).Err()
	if err != nil {
		return "", err
	}

	return state, nil
}

// ValidateLoginOAuthState confirms the state belongs to the login flow and deletes it.
func (s *StravaService) ValidateLoginOAuthState(ctx context.Context, state string) error {
	key := fmt.Sprintf("strava_login_state:%s", state)
	val, err := s.redis.Get(ctx, key).Result()
	if err != nil || val != "login" {
		return errors.New("invalid or expired login state")
	}
	s.redis.Del(ctx, key)
	return nil
}

// GetLoginURL returns the Strava OAuth URL for the unauthenticated login flow.
func (s *StravaService) GetLoginURL(ctx context.Context) (string, error) {
	state, err := s.GenerateLoginOAuthState(ctx)
	if err != nil {
		return "", err
	}
	return s.stravaClient.GetAuthorizationURL(state), nil
}

// LoginWithStrava exchanges the OAuth code and finds or creates a user.
// Returns the user and whether they are newly created.
func (s *StravaService) LoginWithStrava(ctx context.Context, code string) (*models.User, bool, error) {
	tokenResp, err := s.stravaClient.ExchangeToken(code)
	if err != nil {
		return nil, false, err
	}

	athleteID := tokenResp.Athlete.ID

	// Check if this Strava account is already connected to a user.
	var conn models.StravaConnection
	err = s.db.GetContext(ctx, &conn,
		"SELECT * FROM strava_connections WHERE strava_athlete_id = $1", athleteID)
	if err == nil {
		// Existing user — update tokens and return.
		updateQuery := `
			UPDATE strava_connections
			SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
			WHERE strava_athlete_id = $4
		`
		expiresAt := time.Unix(tokenResp.ExpiresAt, 0)
		if _, execErr := s.db.ExecContext(ctx, updateQuery,
			tokenResp.AccessToken, tokenResp.RefreshToken, expiresAt, athleteID); execErr != nil {
			return nil, false, execErr
		}

		var user models.User
		if userErr := s.db.GetContext(ctx, &user, "SELECT * FROM users WHERE id = $1", conn.UserID); userErr != nil {
			return nil, false, userErr
		}
		return &user, false, nil
	}

	// Strava is a data source, not an auth provider. The OAuth state is tied
	// to an authenticated user, so reaching here without finding a user means
	// the state was invalid or the user was deleted. Return an error.
	return nil, false, fmt.Errorf("no user found for strava athlete %d", athleteID)
}

// GetAuthURL returns the Strava OAuth URL with state parameter.
// returnTo is an optional frontend path to redirect to after connection (e.g. "/dashboard").
func (s *StravaService) GetAuthURL(ctx context.Context, userID uuid.UUID, returnTo string) (string, error) {
	state, err := s.GenerateOAuthState(ctx, userID, returnTo)
	if err != nil {
		return "", err
	}
	return s.stravaClient.GetAuthorizationURL(state), nil
}

// ErrStravaAlreadyConnected is returned when the Strava athlete is already linked
// to a different Korsana account.
var ErrStravaAlreadyConnected = errors.New("strava account already connected to another user")

// HandleCallback processes the OAuth callback and saves the connection.
// Returns ErrStravaAlreadyConnected if the athlete is already linked to a different user.
func (s *StravaService) HandleCallback(ctx context.Context, userID uuid.UUID, code string) error {
	// 1. Exchange code for token
	tokenResp, err := s.stravaClient.ExchangeToken(code)
	if err != nil {
		return err
	}

	// 2. Check if this athlete is already connected to a different account.
	var existingUserID uuid.UUID
	lookupErr := s.db.GetContext(ctx, &existingUserID,
		"SELECT user_id FROM strava_connections WHERE strava_athlete_id = $1",
		tokenResp.Athlete.ID,
	)
	if lookupErr == nil && existingUserID != userID {
		return ErrStravaAlreadyConnected
	}

	// 3. Insert or refresh tokens (same user reconnecting is fine).
	query := `
		INSERT INTO strava_connections (
			user_id, strava_athlete_id, access_token, refresh_token, token_expires_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (strava_athlete_id)
		DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			token_expires_at = EXCLUDED.token_expires_at,
			updated_at = NOW()
	`

	expiresAt := time.Unix(tokenResp.ExpiresAt, 0)
	_, err = s.db.ExecContext(ctx, query,
		userID,
		tokenResp.Athlete.ID,
		tokenResp.AccessToken,
		tokenResp.RefreshToken,
		expiresAt,
	)

	return err
}

// GetConnection retrieves the Strava connection for a user
func (s *StravaService) GetConnection(ctx context.Context, userID uuid.UUID) (*models.StravaConnection, error) {
	var conn models.StravaConnection
	err := s.db.GetContext(ctx, &conn, "SELECT * FROM strava_connections WHERE user_id = $1", userID)
	if err != nil {
		return nil, ErrStravaConnectionNotFound
	}
	return &conn, nil
}

func (s *StravaService) getConnectionByID(ctx context.Context, connectionID uuid.UUID) (*models.StravaConnection, error) {
	var conn models.StravaConnection
	err := s.db.GetContext(ctx, &conn, "SELECT * FROM strava_connections WHERE id = $1", connectionID)
	if err != nil {
		return nil, err
	}
	return &conn, nil
}

// RefreshAccessToken refreshes the Strava access token if expired
func (s *StravaService) RefreshAccessToken(ctx context.Context, conn *models.StravaConnection) (*models.StravaConnection, error) {
	// Check if token is expired or about to expire (within 5 minutes)
	if time.Now().Before(conn.TokenExpiresAt.Add(-5 * time.Minute)) {
		// Token still valid
		return conn, nil
	}

	result, err, _ := s.refreshGroup.Do(conn.ID.String(), func() (any, error) {
		latest, loadErr := s.getConnectionByID(ctx, conn.ID)
		if loadErr == nil {
			conn = latest
		}
		if time.Now().Before(conn.TokenExpiresAt.Add(-5 * time.Minute)) {
			return conn, nil
		}

		tokenResp, refreshErr := s.stravaClient.RefreshToken(ctx, conn.RefreshToken)
		if refreshErr != nil {
			return nil, refreshErr
		}

		query := `
			UPDATE strava_connections
			SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
			WHERE id = $4
		`
		expiresAt := time.Unix(tokenResp.ExpiresAt, 0)
		if _, execErr := s.db.ExecContext(ctx, query, tokenResp.AccessToken, tokenResp.RefreshToken, expiresAt, conn.ID); execErr != nil {
			return nil, execErr
		}

		updated := *conn
		updated.AccessToken = tokenResp.AccessToken
		updated.RefreshToken = tokenResp.RefreshToken
		updated.TokenExpiresAt = expiresAt
		updated.UpdatedAt = time.Now()
		return &updated, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*models.StravaConnection), nil
}

// mapStravaType converts Strava activity types to internal types
func mapStravaType(stravaType, sportType string) string {
	t := sportType
	if t == "" {
		t = stravaType
	}
	switch t {
	case "Run", "VirtualRun":
		return models.ActivityTypeRun
	case "Ride", "VirtualRide", "EBikeRide":
		return models.ActivityTypeCycling
	case "Swim":
		return models.ActivityTypeSwimming
	case "Walk":
		return models.ActivityTypeWalking
	case "Hike":
		return models.ActivityTypeHiking
	case "Rowing", "Canoeing":
		return models.ActivityTypeRowing
	case "Elliptical":
		return models.ActivityTypeElliptical
	case "StairStepper":
		return models.ActivityTypeStairMaster
	case "WeightTraining":
		return models.ActivityTypeWeightLifting
	case "Yoga", "Stretching":
		return models.ActivityTypeRecovery
	default:
		return models.ActivityTypeWorkout
	}
}

// parseStravaActivityTime returns the activity's UTC start instant.
// start_date is proper UTC. start_date_local is the athlete's wall clock
// with a fake Z suffix — never use it for time storage; use it only via
// localDateFromStrava to derive the calendar bucket.
func parseStravaActivityTime(act strava.Activity) (time.Time, error) {
	candidate := act.StartDate
	if candidate == "" {
		candidate = act.StartDateLocal
	}
	return time.Parse(time.RFC3339, candidate)
}

// localDateFromStrava extracts the athlete's local calendar date (YYYY-MM-DD)
// from start_date_local, ignoring the bogus Z suffix Strava appends.
func localDateFromStrava(act strava.Activity) (time.Time, error) {
	candidate := act.StartDateLocal
	if candidate == "" {
		candidate = act.StartDate
	}
	if len(candidate) < 10 {
		return time.Time{}, fmt.Errorf("strava activity has no parseable start date: %q", candidate)
	}
	return time.Parse("2006-01-02", candidate[:10])
}

func stravaRateLimitBackoff(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > stravaRateLimitMaxBackoff {
			return stravaRateLimitMaxBackoff
		}
		return retryAfter
	}

	delay := stravaRateLimitBaseBackoff
	for i := 0; i < attempt; i++ {
		delay *= 2
		if delay >= stravaRateLimitMaxBackoff {
			return stravaRateLimitMaxBackoff
		}
	}
	return delay
}

func waitForBackoff(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *StravaService) fetchActivitiesPageWithRetry(ctx context.Context, accessToken string, page, perPage int) ([]strava.Activity, error) {
	var lastErr error

	for attempt := 0; attempt <= stravaRateLimitMaxRetries; attempt++ {
		activities, err := s.stravaClient.GetActivities(ctx, accessToken, page, perPage)
		if err == nil {
			return activities, nil
		}

		var apiErr *strava.APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != 429 {
			return nil, err
		}

		lastErr = err
		if attempt == stravaRateLimitMaxRetries {
			break
		}

		if waitErr := waitForBackoff(ctx, stravaRateLimitBackoff(attempt, apiErr.RetryAfter)); waitErr != nil {
			return nil, waitErr
		}
	}

	return nil, fmt.Errorf("%w: %v", ErrStravaRateLimited, lastErr)
}

func (s *StravaService) latestStravaActivityTime(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var latest sql.NullTime
	if err := s.db.GetContext(ctx, &latest, `
		SELECT MAX(start_time) FROM activities
		WHERE user_id = $1 AND source = 'strava'
	`, userID); err != nil {
		return nil, err
	}
	if !latest.Valid {
		return nil, nil
	}
	return &latest.Time, nil
}

func (s *StravaService) collectActivitiesForSync(ctx context.Context, accessToken string, latestSyncedAt *time.Time, policy stravaSyncPolicy) ([]strava.Activity, bool, int, error) {
	collected := make([]strava.Activity, 0, policy.MaxPages*policy.PerPage)
	partial := false

	for page := 1; page <= policy.MaxPages; page++ {
		pageActivities, err := s.fetchActivitiesPageWithRetry(ctx, accessToken, page, policy.PerPage)
		if err != nil {
			if errors.Is(err, ErrStravaRateLimited) && len(collected) > 0 {
				return collected, true, page - 1, nil
			}
			return nil, false, page - 1, err
		}
		if len(pageActivities) == 0 {
			return collected, partial, page, nil
		}

		reachedKnownBoundary := false
		if latestSyncedAt == nil {
			collected = append(collected, pageActivities...)
		} else {
			for _, act := range pageActivities {
				startTime, parseErr := parseStravaActivityTime(act)
				if parseErr != nil {
					collected = append(collected, act)
					continue
				}
				if !startTime.After(*latestSyncedAt) {
					reachedKnownBoundary = true
					break
				}
				collected = append(collected, act)
			}
		}

		if reachedKnownBoundary {
			return collected, partial, page, nil
		}
		if len(pageActivities) < policy.PerPage {
			return collected, partial, page, nil
		}
	}

	if latestSyncedAt == nil && len(collected) > 0 {
		partial = true
	}
	return collected, partial, policy.MaxPages, nil
}

func pluralSuffix(count int) string {
	if count == 1 {
		return "y"
	}
	return "ies"
}

func buildStravaSyncResult(count int, partial bool, policy stravaSyncPolicy, pagesFetched int) StravaSyncResult {
	result := StravaSyncResult{
		Count:        count,
		Partial:      partial,
		PagesFetched: pagesFetched,
	}

	switch {
	case partial && count > 0 && policy.Mode == "initial_backfill":
		result.Status = "partial"
		result.Message = fmt.Sprintf("Synced %d recent Strava activit%s. Older backlog will continue on later syncs.", count, pluralSuffix(count))
	case partial && count > 0:
		result.Status = "partial"
		result.Message = fmt.Sprintf("Synced %d Strava activit%s before hitting a temporary API limit.", count, pluralSuffix(count))
	case count == 0:
		result.Status = "noop"
		result.Message = "No new Strava activities found."
	default:
		result.Status = "success"
		result.Message = fmt.Sprintf("Synced %d Strava activit%s successfully.", count, pluralSuffix(count))
	}

	return result
}

// SyncActivities fetches and stores recent activities from Strava using a bounded sync policy.
func (s *StravaService) SyncActivities(ctx context.Context, userID uuid.UUID) (*StravaSyncResult, error) {
	// Get connection
	conn, err := s.GetConnection(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Refresh token if needed
	conn, err = s.RefreshAccessToken(ctx, conn)
	if err != nil {
		return nil, err
	}

	latestSyncedAt, err := s.latestStravaActivityTime(ctx, userID)
	if err != nil {
		return nil, err
	}
	policy := syncPolicyForHistory(latestSyncedAt != nil)
	activities, partial, pagesFetched, err := s.collectActivitiesForSync(ctx, conn.AccessToken, latestSyncedAt, policy)
	if err != nil {
		return nil, err
	}

	syncedCount := 0
	insertFailCount := 0

	for _, act := range activities {
		startTime, err := parseStravaActivityTime(act)
		if err != nil {
			logger.FromContext(ctx).Warn("strava sync: skipping activity, bad date format",
				"activity_id", act.ID,
				"activity_name", act.Name,
				"error", err,
			)
			continue
		}

		// local_date is the athlete's calendar bucket; downstream queries
		// (calendar, weekly summaries) prefer it over start_time::date.
		var localDatePtr *time.Time
		if ld, ldErr := localDateFromStrava(act); ldErr == nil {
			localDatePtr = &ld
		} else {
			logger.FromContext(ctx).Warn("strava sync: missing local date",
				"activity_id", act.ID,
				"error", ldErr,
			)
		}

		internalType := mapStravaType(act.Type, act.SportType)

		var avgPace float64
		if models.DistanceBasedTypes[internalType] && act.Distance > 0 {
			distanceKm := act.Distance / 1000.0
			avgPace = float64(act.MovingTime) / distanceKm
		}

		var avgHR *int
		if act.AverageHeartrate > 0 {
			hr := int(act.AverageHeartrate)
			avgHR = &hr
		}

		var elevGain *float64
		if act.TotalElevationGain > 0 {
			elevGain = &act.TotalElevationGain
		}

		var maxHR *int
		if act.MaxHeartrate > 0 {
			mhr := int(act.MaxHeartrate)
			maxHR = &mhr
		}

		var cadence *float64
		if act.AverageCadence > 0 {
			cadence = &act.AverageCadence
		}

		var sufferScore *int
		if act.SufferScore > 0 {
			ss := int(math.Round(act.SufferScore))
			sufferScore = &ss
		}

		activity := &models.Activity{
			ID:                      uuid.New(),
			UserID:                  userID,
			Source:                  "strava",
			SourceActivityID:        fmt.Sprintf("%d", act.ID),
			ActivityType:            internalType,
			Name:                    act.Name,
			DistanceMeters:          act.Distance,
			DurationSeconds:         act.MovingTime,
			StartTime:               startTime,
			LocalDate:               localDatePtr,
			AveragePaceSecondsPerKm: avgPace,
			AverageHeartRate:        avgHR,
			MaxHeartRate:            maxHR,
			ElevationGainMeters:     elevGain,
			AverageCadence:          cadence,
			SufferScore:             sufferScore,
			SyncedAt:                time.Now(),
		}

		query := `
			INSERT INTO activities (
				id, user_id, source, source_activity_id, activity_type, name,
				distance_meters, duration_seconds, start_time, local_date, average_pace_seconds_per_km,
				average_heart_rate, max_heart_rate, elevation_gain_meters,
				average_cadence, suffer_score, synced_at
			) VALUES (
				:id, :user_id, :source, :source_activity_id, :activity_type, :name,
				:distance_meters, :duration_seconds, :start_time, :local_date, :average_pace_seconds_per_km,
				:average_heart_rate, :max_heart_rate, :elevation_gain_meters,
				:average_cadence, :suffer_score, :synced_at
			)
			ON CONFLICT (user_id, source, source_activity_id) DO UPDATE SET
				name = EXCLUDED.name,
				activity_type = EXCLUDED.activity_type,
				distance_meters = EXCLUDED.distance_meters,
				duration_seconds = EXCLUDED.duration_seconds,
				start_time = EXCLUDED.start_time,
				local_date = EXCLUDED.local_date,
				average_pace_seconds_per_km = EXCLUDED.average_pace_seconds_per_km,
				average_heart_rate = EXCLUDED.average_heart_rate,
				max_heart_rate = EXCLUDED.max_heart_rate,
				elevation_gain_meters = EXCLUDED.elevation_gain_meters,
				average_cadence = EXCLUDED.average_cadence,
				suffer_score = EXCLUDED.suffer_score,
				synced_at = EXCLUDED.synced_at
		`

		// RETURNING id captures the real stored ID in one round-trip.
		// ON CONFLICT DO UPDATE keeps the original row, so this avoids a
		// separate SELECT that would otherwise double the DB calls per activity.
		rows, err := s.db.NamedQueryContext(ctx, query+" RETURNING id", activity)
		if err != nil {
			logger.FromContext(ctx).Error("strava sync: failed to upsert activity",
				"activity_id", act.ID,
				"activity_name", act.Name,
				"error", err,
			)
			insertFailCount++
			continue
		}
		if rows.Next() {
			var storedID uuid.UUID
			if scanErr := rows.Scan(&storedID); scanErr == nil {
				activity.ID = storedID
			}
		}
		rows.Close()

		if s.calendarSvc != nil {
			_ = s.calendarSvc.AutoMatchActivity(ctx, userID, activity)
		}

		// Mirror non-run Strava activities into cross_training_sessions so the
		// widget shows them without requiring manual entry. Uses strava_activity_id
		// as the conflict key to make re-syncs idempotent.
		if ctType := crossTrainingType(internalType); ctType != "" {
			durationMins := act.MovingTime / 60
			if durationMins < 1 {
				durationMins = 1
			}
			stravaIDStr := fmt.Sprintf("%d", act.ID)
			var distPtr *float64
			if act.Distance > 0 {
				distPtr = &act.Distance
			}
			// Bucket by the athlete's local calendar date so cross-training
			// rows line up with the user's run history regardless of UTC offset.
			ctDate := startTime.UTC().Truncate(24 * time.Hour)
			if localDatePtr != nil {
				ctDate = *localDatePtr
			}
			_, _ = s.db.ExecContext(ctx, `
				INSERT INTO cross_training_sessions
					(id, user_id, type, date, duration_minutes, distance_meters, source, strava_activity_id)
				VALUES ($1, $2, $3, $4, $5, $6, 'strava', $7)
				ON CONFLICT (strava_activity_id) DO UPDATE SET
					type = EXCLUDED.type,
					date = EXCLUDED.date,
					duration_minutes = EXCLUDED.duration_minutes,
					distance_meters = EXCLUDED.distance_meters
			`, uuid.New(), userID, ctType, ctDate, durationMins, distPtr, stravaIDStr)
		}

		syncedCount++
	}

	// If every activity failed to insert, surface the error so the caller
	// does not silently report zero synced when the real issue is a DB problem.
	if insertFailCount > 0 && syncedCount == 0 && len(activities) > 0 {
		return nil, fmt.Errorf(
			"all %d activities failed to save - check server logs for details (hint: ensure migration 005 has been applied to your database)",
			insertFailCount,
		)
	}

	// After syncing, compute and upsert weekly summaries.
	if syncedCount > 0 {
		_ = s.computeWeeklySummaries(ctx, userID)
	}

	result := buildStravaSyncResult(syncedCount, partial, policy, pagesFetched)
	return &result, nil
}

// computeWeeklySummaries aggregates activity data into weekly_summaries.
// Buckets by local_date so totals match the calendar week as the athlete
// lived it. Legacy rows without local_date fall back to start_time::date.
func (s *StravaService) computeWeeklySummaries(ctx context.Context, userID uuid.UUID) error {
	query := `
		WITH bucketed AS (
			SELECT
				user_id,
				distance_meters,
				duration_seconds,
				date_trunc('week', COALESCE(local_date, start_time::date))::date AS week_start
			FROM activities
			WHERE user_id = $1
				AND COALESCE(local_date, start_time::date) >= (CURRENT_DATE - INTERVAL '8 weeks')
		)
		INSERT INTO weekly_summaries (id, user_id, week_start, total_distance_meters, total_duration_seconds, run_count, average_pace_seconds_per_km, longest_run_meters, updated_at)
		SELECT
			gen_random_uuid(),
			user_id,
			week_start,
			SUM(distance_meters) AS total_distance_meters,
			SUM(duration_seconds) AS total_duration_seconds,
			COUNT(*) AS run_count,
			CASE WHEN SUM(distance_meters) > 0
				THEN SUM(duration_seconds) / (SUM(distance_meters) / 1000.0)
				ELSE 0
			END AS average_pace_seconds_per_km,
			MAX(distance_meters) AS longest_run_meters,
			NOW()
		FROM bucketed
		GROUP BY user_id, week_start
		ON CONFLICT (user_id, week_start) DO UPDATE SET
			total_distance_meters = EXCLUDED.total_distance_meters,
			total_duration_seconds = EXCLUDED.total_duration_seconds,
			run_count = EXCLUDED.run_count,
			average_pace_seconds_per_km = EXCLUDED.average_pace_seconds_per_km,
			longest_run_meters = EXCLUDED.longest_run_meters,
			updated_at = NOW()
	`
	_, err := s.db.ExecContext(ctx, query, userID)
	return err
}

// GetUserActivities retrieves activities for a user
func (s *StravaService) GetUserActivities(ctx context.Context, userID uuid.UUID, limit, offset int) ([]models.Activity, int, error) {
	if limit <= 0 {
		limit = 30
	}

	var total int
	err := s.db.GetContext(ctx, &total, "SELECT COUNT(*) FROM activities WHERE user_id = $1", userID)
	if err != nil {
		return nil, 0, err
	}

	var activities []models.Activity
	query := `
		SELECT * FROM activities
		WHERE user_id = $1
		ORDER BY start_time DESC
		LIMIT $2 OFFSET $3
	`
	err = s.db.SelectContext(ctx, &activities, query, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	return activities, total, nil
}

// DisconnectStrava removes the user's Strava connection
func (s *StravaService) DisconnectStrava(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM strava_connections WHERE user_id = $1", userID)
	return err
}

// crossTrainingType maps an internal activity type to the cross_training_sessions
// type string. Returns "" for run-type activities which should not be mirrored.
func crossTrainingType(activityType string) string {
	switch activityType {
	case models.ActivityTypeCycling:
		return "cycling"
	case models.ActivityTypeSwimming:
		return "swimming"
	case models.ActivityTypeWeightLifting:
		return "weight_lifting"
	case models.ActivityTypeElliptical:
		return "elliptical"
	case models.ActivityTypeRowing:
		return "rowing"
	case models.ActivityTypeWalking:
		return "walking"
	case models.ActivityTypeHiking:
		return "hiking"
	default:
		return ""
	}
}
