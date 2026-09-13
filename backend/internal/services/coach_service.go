package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/korsana/backend/internal/config"
	"github.com/korsana/backend/internal/database"
	"github.com/korsana/backend/internal/logger"
	"github.com/korsana/backend/internal/metrics"
	"github.com/korsana/backend/internal/models"
)

// CoachService handles AI coaching logic
type CoachService struct {
	db                 *database.DB
	rdb                *redis.Client
	config             *config.Config
	httpClient         *http.Client
	goalsService       *GoalsService
	calendarService    *CalendarService
	userProfileService *UserProfileService
}

// NewCoachService creates a new coach service
func NewCoachService(db *database.DB, rdb *redis.Client, cfg *config.Config, goalsService *GoalsService, calendarService *CalendarService, userProfileService *UserProfileService) *CoachService {
	switch {
	case cfg.GeminiAPIKey != "":
		slog.Info("[Coach] Gemini API key configured", "key_length", len(cfg.GeminiAPIKey))
	case cfg.ClaudeAPIKey != "":
		slog.Info("[Coach] Claude API key configured", "key_length", len(cfg.ClaudeAPIKey))
	default:
		slog.Warn("[Coach] No AI API key configured — coach will not work")
	}

	return &CoachService{
		db:                 db,
		rdb:                rdb,
		config:             cfg,
		httpClient:         &http.Client{Timeout: 60 * time.Second},
		goalsService:       goalsService,
		calendarService:    calendarService,
		userProfileService: userProfileService,
	}
}

// ChatMessage represents a message in a provider-agnostic format
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ClaudeRequest represents the request to Claude API
type ClaudeRequest struct {
	Model     string        `json:"model"`
	MaxTokens int           `json:"max_tokens"`
	Messages  []ChatMessage `json:"messages"`
	System    string        `json:"system,omitempty"`
}

// ClaudeResponse represents the response from Claude API
type ClaudeResponse struct {
	Content []struct {
		Text string `json:"text"`
	} `json:"content"`
}

// Gemini API types
type GeminiPart struct {
	Text string `json:"text"`
}

type GeminiContent struct {
	Role  string       `json:"role"`
	Parts []GeminiPart `json:"parts"`
}

type GeminiRequest struct {
	Contents          []GeminiContent  `json:"contents"`
	SystemInstruction *GeminiContent   `json:"systemInstruction,omitempty"`
	GenerationConfig  *GeminiGenConfig `json:"generationConfig,omitempty"`
}

type GeminiGenConfig struct {
	MaxOutputTokens int `json:"maxOutputTokens"`
}

type GeminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []GeminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

// CreateSession creates a new named coaching session for a user.
func (s *CoachService) CreateSession(ctx context.Context, userID uuid.UUID) (*models.CoachSession, error) {
	session := &models.CoachSession{
		ID:        uuid.New(),
		UserID:    userID,
		Title:     "New session",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	_, err := s.db.NamedExecContext(ctx, `
		INSERT INTO coach_sessions (id, user_id, title, created_at, updated_at)
		VALUES (:id, :user_id, :title, :created_at, :updated_at)
	`, session)
	if err != nil {
		return nil, err
	}
	return session, nil
}

// coachListRowCap caps any service-layer limit at this ceiling so a caller
// passing a runaway value can't pull unbounded rows. Matches the handler
// MaxPageSize constant; duplicated to avoid an import cycle.
const coachListRowCap = 200

// GetSessions returns a page of the user's coaching sessions, newest first,
// along with the total row count for pagination UI. Limit is clamped to
// coachListRowCap; offset is clamped to >= 0.
func (s *CoachService) GetSessions(ctx context.Context, userID uuid.UUID, limit, offset int) ([]models.CoachSession, int, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > coachListRowCap {
		limit = coachListRowCap
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.GetContext(ctx, &total,
		`SELECT COUNT(*) FROM coach_sessions WHERE user_id = $1`, userID); err != nil {
		return nil, 0, err
	}

	var sessions []models.CoachSession
	err := s.db.SelectContext(ctx, &sessions, `
		SELECT * FROM coach_sessions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	return sessions, total, nil
}

// GetSessionMessages returns messages belonging to a specific session.
func (s *CoachService) GetSessionMessages(ctx context.Context, userID, sessionID uuid.UUID) ([]models.CoachConversation, error) {
	var messages []models.CoachConversation
	err := s.db.SelectContext(ctx, &messages, `
		SELECT id, user_id, role, content, created_at, session_id
		FROM coach_conversations
		WHERE user_id = $1 AND session_id = $2
		ORDER BY created_at ASC
		LIMIT 200
	`, userID, sessionID)
	if err != nil {
		return nil, err
	}
	return messages, nil
}

// ArtifactResult is a structured AI output returned alongside the text response.
type ArtifactResult struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// EvidenceItem is a single data point attached to a chat response as context.
type EvidenceItem struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Signal string `json:"signal"` // "positive" | "warning" | "neutral"
}

const (
	coachModeCopilot           = "copilot"
	coachModeGuide             = "guide"
	maxCoachConcernHistory     = 5
	coachStatePersistLimit     = 3 * time.Second
	maxContextPersonalRecords  = 5
	maxContextTrainingZones    = 5
	maxContextActivities       = 30
	maxContextSessionSummaries = 2
	maxContextFlaggedConcerns  = 5
	maxContextWeeklySummaries  = 6
	maxContextUpcomingEntries  = 7
)

// ErrInvalidCoachMode is returned when the client sends an unsupported coach mode.
var ErrInvalidCoachMode = errors.New("invalid coach mode")

func normalizeCoachMode(mode string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(mode))
	switch normalized {
	case "", coachModeCopilot:
		return coachModeCopilot, nil
	case coachModeGuide:
		return coachModeGuide, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidCoachMode, mode)
	}
}

// buildEvidenceItems assembles 2 quick context data points for the "Why?" block.
// Two fast DB reads only — no AI call, no added latency to the chat response.
func (s *CoachService) buildEvidenceItems(ctx context.Context, userID uuid.UUID) []EvidenceItem {
	var items []EvidenceItem

	if goal, err := s.goalsService.GetActiveGoal(ctx, userID); err == nil {
		daysUntil := int(time.Until(goal.RaceDate).Hours() / 24)
		weeksOut := daysUntil / 7
		signal := "positive"
		if weeksOut < 6 {
			signal = "warning"
		}
		items = append(items, EvidenceItem{
			Label:  "Weeks to " + goal.RaceName,
			Value:  fmt.Sprintf("%d weeks", weeksOut),
			Signal: signal,
		})
	}

	var latest models.WeeklySummary
	if err := s.db.GetContext(ctx, &latest, `
		SELECT * FROM weekly_summaries
		WHERE user_id = $1
		ORDER BY week_start DESC
		LIMIT 1
	`, userID); err == nil {
		distMi := latest.TotalDistanceMeters / 1000.0 * 0.621371
		runWord := "run"
		if latest.RunCount != 1 {
			runWord = "runs"
		}
		signal := "neutral"
		if latest.RunCount >= 4 {
			signal = "positive"
		} else if latest.RunCount <= 1 {
			signal = "warning"
		}
		items = append(items, EvidenceItem{
			Label:  "Last week",
			Value:  fmt.Sprintf("%.0f mi · %d %s", distMi, latest.RunCount, runWord),
			Signal: signal,
		})
	}

	return items
}

// sessionSummary derives a ≤140-char summary from the first assistant response.
func sessionSummary(response string) string {
	response = strings.TrimSpace(response)
	for _, sep := range []string{". ", "! ", "? "} {
		if idx := strings.Index(response, sep); idx > 0 && idx < 140 {
			return response[:idx+1]
		}
	}
	const max = 140
	if len(response) <= max {
		return response
	}
	candidate := response[:max]
	if lastSpace := strings.LastIndex(candidate, " "); lastSpace > 50 {
		return candidate[:lastSpace] + "…"
	}
	return candidate + "…"
}

// coachState is the persisted per-user continuity blob stored in users.coach_state.
type coachState struct {
	FlaggedConcerns []flaggedConcern `json:"flagged_concerns,omitempty"`
}

// flaggedConcern is a single concern extracted from a coach response.
type flaggedConcern struct {
	Text string `json:"text"`
	Date string `json:"date"`
}

type raceStrategyPhase struct {
	Phase    string `json:"phase"`
	Guidance string `json:"guidance"`
}

func normalizeConcernText(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}

func mergeFlaggedConcerns(existing []flaggedConcern, incoming flaggedConcern, limit int) []flaggedConcern {
	if limit <= 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(existing)+1)
	merged := make([]flaggedConcern, 0, min(limit, len(existing)+1))

	if normalized := normalizeConcernText(incoming.Text); normalized != "" {
		seen[normalized] = struct{}{}
		merged = append(merged, incoming)
	}

	for _, concern := range existing {
		normalized := normalizeConcernText(concern.Text)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		merged = append(merged, concern)
		if len(merged) == limit {
			break
		}
	}

	return merged
}

func limitContextItems[T any](items []T, limit int) []T {
	if limit <= 0 || len(items) == 0 {
		return nil
	}
	if len(items) <= limit {
		return items
	}
	return items[:limit]
}

// concernKeywords trigger concern extraction when found in a coach response.
var concernKeywords = []string{
	"knee", "pain", "injury", "injur", "overtraining", "too much", "too fast",
	"be careful", "watch your", "risk of", "warning", "concerning", "concern",
	"sharp increase", "mileage jump", "consecutive hard", "fatigue",
}

// extractConcern scans the response for flagged health or load signals.
// Returns a short concern string (≤100 chars) or "" if nothing notable found.
func extractConcern(response string) string {
	lower := strings.ToLower(response)
	for _, kw := range concernKeywords {
		if !strings.Contains(lower, kw) {
			continue
		}
		// Find the sentence containing the keyword and trim to ≤100 chars.
		for _, sep := range []string{". ", "! ", "? ", "\n"} {
			start := 0
			for {
				idx := strings.Index(lower[start:], kw)
				if idx < 0 {
					break
				}
				absIdx := start + idx
				// Walk back to sentence start
				sentStart := strings.LastIndexAny(lower[:absIdx], ".!?\n")
				if sentStart < 0 {
					sentStart = 0
				} else {
					sentStart += 2
				}
				sentEnd := strings.Index(lower[absIdx:], sep)
				if sentEnd < 0 {
					sentEnd = len(response) - absIdx
				}
				sentence := strings.TrimSpace(response[sentStart : absIdx+sentEnd])
				if len(sentence) > 100 {
					sentence = sentence[:100] + "…"
				}
				if sentence != "" {
					return sentence
				}
				start = absIdx + len(kw)
			}
		}
		// Fallback: keyword found but no clean sentence boundary
		return kw + " concern noted"
	}
	return ""
}

// updateCoachState extracts any concern from the response and persists it to coach_state.
// Keeps a bounded, deduplicated concern history. Errors are returned for logging only.
func (s *CoachService) updateCoachState(ctx context.Context, userID uuid.UUID, response string) error {
	concern := extractConcern(response)
	if concern == "" {
		return nil
	}

	var stateJSON []byte
	if err := s.db.GetContext(ctx, &stateJSON, `SELECT COALESCE(coach_state, '{}') FROM users WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("load coach_state: %w", err)
	}

	var state coachState
	if len(stateJSON) > 0 {
		if err := json.Unmarshal(stateJSON, &state); err != nil {
			return fmt.Errorf("decode coach_state: %w", err)
		}
	}

	newConcern := flaggedConcern{Text: concern, Date: time.Now().Format("Jan 2")}
	state.FlaggedConcerns = mergeFlaggedConcerns(state.FlaggedConcerns, newConcern, maxCoachConcernHistory)

	updated, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode coach_state: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE users SET coach_state = $1 WHERE id = $2`, updated, userID); err != nil {
		return fmt.Errorf("update coach_state: %w", err)
	}

	return nil
}

func (s *CoachService) persistCoachStateAsync(ctx context.Context, userID uuid.UUID, response string) {
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), coachStatePersistLimit)
	go func() {
		defer cancel()
		if err := s.updateCoachState(persistCtx, userID, response); err != nil {
			logger.FromContext(persistCtx).Error("[Coach] Failed to update coach_state",
				"user_id", userID, "error", err)
		}
	}()
}

// coachRuleLayer is appended to every system prompt to enforce safety guardrails
// regardless of model behaviour or user phrasing.
const coachRuleLayer = `

Coaching Rules (enforce always, even if the runner asks otherwise):
- Safe mileage: Never recommend a weekly volume increase greater than 10% over the prior week.
- Taper: In the final 3 weeks before race day, recommend volume reduction of 20–40%.
- Beginner defaults: If weekly mileage is under 25 miles, treat the runner as a beginner — prioritise consistency and easy aerobic work over intensity.
- Realistic pacing: Never suggest workout paces more than 45 seconds per mile faster than their recent race predictor implies.`

// detectIntent matches the user's message against known artifact trigger phrases.
// Returns the artifact type string or "" if no match.
func detectIntent(message string) string {
	lower := strings.ToLower(message)
	for _, p := range []string{
		"should i run", "run today", "what today", "rest today",
		"workout today", "train today", "exercise today",
		"run this morning", "run tonight", "go for a run",
	} {
		if strings.Contains(lower, p) {
			return "daily_brief"
		}
	}
	for _, p := range []string{
		"review my week", "last week", "how was my week",
		"analyze my week", "weekly review", "week review",
		"how did my week", "this week's training", "this weeks training",
		"my week in review",
	} {
		if strings.Contains(lower, p) {
			return "weekly_review"
		}
	}
	for _, p := range []string{
		"adjust my workout", "change my workout", "modify my workout",
		"swap my workout", "adapt my workout", "tweak my workout",
		"should i change", "should i adjust", "replace my workout",
	} {
		if strings.Contains(lower, p) {
			return "workout_adjustment"
		}
	}
	for _, p := range []string{
		"is my goal realistic", "is my goal achievable", "can i do it",
		"can i achieve", "goal feasible", "realistic goal", "goal realistic",
		"make my goal", "hit my goal", "goal possible", "feasibility",
		"is it realistic", "can i hit",
	} {
		if strings.Contains(lower, p) {
			return "goal_feasibility"
		}
	}
	for _, p := range []string{
		"race week", "race day", "race strategy", "how to pace", "pacing strategy",
		"race plan", "how should i race", "race morning", "race tips",
		"what to do race", "final week", "race preparation", "race prep",
		"taper week", "day before race", "race eve",
	} {
		if strings.Contains(lower, p) {
			return "race_strategy"
		}
	}
	return ""
}

// artifactInstruction returns the structured output prompt addendum for a detected intent.
func artifactInstruction(intent string) string {
	switch intent {
	case "daily_brief":
		return "\n\nAfter your response, on a new line, include a structured artifact block with real values from the runner's data. Use EXACTLY this format:\n```artifact\n{\"type\":\"daily_brief\",\"recommendation\":\"run_easy\",\"headline\":\"Short decision headline.\",\"reason\":\"Reason based on their data.\",\"evidence\":[\"Evidence point 1\",\"Evidence point 2\"],\"workout_suggestion\":{\"type\":\"Easy\",\"distance\":6,\"pace\":\"9:30\"}}\n```"
	case "weekly_review":
		return "\n\nAfter your response, on a new line, include a structured artifact block with real values from the runner's data. Use EXACTLY this format:\n```artifact\n{\"type\":\"weekly_review\",\"week\":\"Apr 7-13\",\"summary\":\"One sentence summary.\",\"metrics\":[{\"label\":\"Volume\",\"value\":\"38mi\",\"vs_plan\":\"+2mi\",\"signal\":\"positive\"}],\"highlights\":[\"Key highlight\"],\"risks\":[\"Key risk if any\"],\"next_focus\":\"What to focus on next week.\"}\n```"
	case "workout_adjustment":
		return "\n\nAfter your response, on a new line, include a structured artifact block showing the adjustment. Use EXACTLY this format:\n```artifact\n{\"type\":\"workout_adjustment\",\"original\":{\"date\":\"2026-04-15\",\"type\":\"Tempo\",\"distance\":10},\"adjusted\":{\"type\":\"Easy\",\"distance\":7,\"reason\":\"Fatigue signal detected.\"},\"action\":\"replace_calendar_entry\"}\n```"
	case "goal_feasibility":
		return "\n\nAfter your response, on a new line, include a structured artifact block assessing the goal. Use EXACTLY this format:\n```artifact\n{\"type\":\"goal_feasibility\",\"verdict\":\"stretch\",\"confidence\":0.74,\"headline\":\"One sentence verdict.\",\"evidence\":[\"Evidence point 1\",\"Evidence point 2\"],\"gap\":\"What needs to improve and by how much.\",\"recommendation\":\"Specific actionable recommendation.\"}\n```"
	case "race_strategy":
		return "\n\nAfter your response, on a new line, include a structured artifact block with a concrete race plan. Use EXACTLY this format:\n```artifact\n{\"type\":\"race_strategy\",\"headline\":\"One sentence race-day directive.\",\"target_pace\":\"9:10/mi\",\"phases\":[{\"phase\":\"Start (mi 1-3)\",\"guidance\":\"Hold back — run 15s/mi slower than goal pace.\"},{\"phase\":\"Middle (mi 4-22)\",\"guidance\":\"Settle into goal pace. Fuel every 45 min.\"},{\"phase\":\"Finish (mi 23-26.2)\",\"guidance\":\"Push only if you feel strong. Don't chase others.\"}],\"key_reminders\":[\"Start conservative\",\"Fuel early and often\",\"Watch for early HR spikes\"]}\n```"
	}
	return ""
}

func validateArtifactPayload(artifactType string, payload []byte) error {
	switch artifactType {
	case "daily_brief":
		var artifact struct {
			Type              string          `json:"type"`
			Recommendation    string          `json:"recommendation"`
			Headline          string          `json:"headline"`
			Reason            string          `json:"reason"`
			WorkoutSuggestion json.RawMessage `json:"workout_suggestion"`
		}
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return fmt.Errorf("decode daily_brief: %w", err)
		}
		if strings.TrimSpace(artifact.Recommendation) == "" || strings.TrimSpace(artifact.Headline) == "" || strings.TrimSpace(artifact.Reason) == "" {
			return errors.New("daily_brief requires recommendation, headline, and reason")
		}
		if trimmed := bytes.TrimSpace(artifact.WorkoutSuggestion); len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
			return errors.New("daily_brief requires workout_suggestion")
		}
	case "weekly_review":
		var artifact struct {
			Type    string `json:"type"`
			Week    string `json:"week"`
			Summary string `json:"summary"`
		}
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return fmt.Errorf("decode weekly_review: %w", err)
		}
		if strings.TrimSpace(artifact.Week) == "" || strings.TrimSpace(artifact.Summary) == "" {
			return errors.New("weekly_review requires week and summary")
		}
	case "workout_adjustment":
		var artifact struct {
			Type     string          `json:"type"`
			Original json.RawMessage `json:"original"`
			Adjusted json.RawMessage `json:"adjusted"`
		}
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return fmt.Errorf("decode workout_adjustment: %w", err)
		}
		original := bytes.TrimSpace(artifact.Original)
		adjusted := bytes.TrimSpace(artifact.Adjusted)
		if len(original) == 0 || bytes.Equal(original, []byte("null")) || len(adjusted) == 0 || bytes.Equal(adjusted, []byte("null")) {
			return errors.New("workout_adjustment requires original and adjusted blocks")
		}
	case "goal_feasibility":
		var artifact struct {
			Type     string `json:"type"`
			Verdict  string `json:"verdict"`
			Headline string `json:"headline"`
		}
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return fmt.Errorf("decode goal_feasibility: %w", err)
		}
		if strings.TrimSpace(artifact.Verdict) == "" || strings.TrimSpace(artifact.Headline) == "" {
			return errors.New("goal_feasibility requires verdict and headline")
		}
	case "race_strategy":
		var artifact struct {
			Type         string              `json:"type"`
			Headline     string              `json:"headline"`
			TargetPace   string              `json:"target_pace"`
			Phases       []raceStrategyPhase `json:"phases"`
			KeyReminders []string            `json:"key_reminders"`
		}
		if err := json.Unmarshal(payload, &artifact); err != nil {
			return fmt.Errorf("decode race_strategy: %w", err)
		}
		if strings.TrimSpace(artifact.Headline) == "" || strings.TrimSpace(artifact.TargetPace) == "" {
			return errors.New("race_strategy requires headline and target_pace")
		}
		if len(artifact.Phases) == 0 {
			return errors.New("race_strategy requires at least one phase")
		}
		for _, phase := range artifact.Phases {
			if strings.TrimSpace(phase.Phase) == "" || strings.TrimSpace(phase.Guidance) == "" {
				return errors.New("race_strategy phases require phase and guidance")
			}
		}
		if len(artifact.KeyReminders) == 0 {
			return errors.New("race_strategy requires key_reminders")
		}
	default:
		return fmt.Errorf("unsupported artifact type %q", artifactType)
	}

	return nil
}

// extractArtifact parses a ```artifact ... ``` block from the AI response.
// Returns the cleaned response text (artifact block removed) and the parsed artifact.
// If parsing or validation fails, returns the cleaned response and nil — never breaks the chat.
func extractArtifact(response string) (string, *ArtifactResult) {
	before, after, found := strings.Cut(response, "```artifact")
	if !found {
		return response, nil
	}
	content, trailing, found := strings.Cut(after, "```")
	if !found {
		return response, nil
	}
	artifactJSON := strings.TrimSpace(content)

	// Build clean response by removing the artifact block
	cleanResponse := strings.TrimSpace(before)
	if rem := strings.TrimSpace(trailing); rem != "" {
		cleanResponse = cleanResponse + "\n" + rem
	}
	cleanResponse = strings.TrimSpace(cleanResponse)

	// Parse artifact type from JSON
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(artifactJSON), &raw); err != nil {
		slog.Warn("[Coach] Artifact JSON parse error", "error", err)
		return cleanResponse, nil
	}
	typeBytes, ok := raw["type"]
	if !ok {
		return cleanResponse, nil
	}
	var artifactType string
	if err := json.Unmarshal(typeBytes, &artifactType); err != nil {
		return cleanResponse, nil
	}
	artifactType = strings.TrimSpace(artifactType)
	if artifactType == "" {
		return cleanResponse, nil
	}
	if err := validateArtifactPayload(artifactType, []byte(artifactJSON)); err != nil {
		slog.Warn("[Coach] Artifact validation error",
			"artifact_type", artifactType, "error", err)
		return cleanResponse, nil
	}

	return cleanResponse, &ArtifactResult{
		Type: artifactType,
		Data: json.RawMessage(artifactJSON),
	}
}

// SendMessage sends a message to the AI coach and gets a response.
// sessionID is optional — if provided messages are stored under that session.
// mode is "copilot" (proactive) or "guide" (reactive); defaults to "copilot".
// Returns: cleanResponse, artifact, evidence, generatedTitle, error.
func (s *CoachService) SendMessage(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, userMessage, mode string) (string, *ArtifactResult, []EvidenceItem, string, error) {
	normalizedMode, err := normalizeCoachMode(mode)
	if err != nil {
		return "", nil, nil, "", err
	}

	// Build context about user's training
	trainingContext, err := s.buildTrainingContext(ctx, userID)
	if err != nil {
		trainingContext = "No training data available yet."
	}

	// Fetch recent messages for context: prefer session messages, fall back to global
	var recentMessages []models.CoachConversation
	if sessionID != nil {
		err = s.db.SelectContext(ctx, &recentMessages, `
			SELECT id, user_id, role, content, created_at, session_id
			FROM coach_conversations
			WHERE user_id = $1 AND session_id = $2
			ORDER BY created_at DESC LIMIT 10
		`, userID, *sessionID)
	} else {
		err = s.db.SelectContext(ctx, &recentMessages, `
			SELECT id, user_id, role, content, created_at, session_id
			FROM coach_conversations
			WHERE user_id = $1
			ORDER BY created_at DESC LIMIT 10
		`, userID)
	}
	if err != nil {
		recentMessages = []models.CoachConversation{}
	}

	// Reverse to chronological order
	for i, j := 0, len(recentMessages)-1; i < j; i, j = i+1, j-1 {
		recentMessages[i], recentMessages[j] = recentMessages[j], recentMessages[i]
	}

	messages := []ChatMessage{}
	for _, msg := range recentMessages {
		messages = append(messages, ChatMessage{Role: msg.Role, Content: msg.Content})
	}
	messages = append(messages, ChatMessage{Role: "user", Content: userMessage})

	// Mode instruction
	modeInstruction := "\n\nCoaching Mode: COPILOT — Be proactive. Surface patterns you see before they ask. Suggest training adjustments even when not explicitly requested."
	if normalizedMode == coachModeGuide {
		modeInstruction = "\n\nCoaching Mode: GUIDE — Be reactive. Answer questions thoroughly. Avoid making changes or suggestions the runner didn't explicitly ask about."
	}

	// Artifact instruction (appended when intent is detected)
	intent := detectIntent(userMessage)
	artifactInstr := artifactInstruction(intent)

	systemPrompt := fmt.Sprintf(`You are Korsana, an experienced endurance and strength training coach with expertise in marathon training, cross-training, and periodized fitness programs. You provide evidence-based, personalized advice to runners.

Your coaching philosophy:
- Hybrid approach: Combine established training principles (periodization, 80/20 rule, progressive overload) with personalized recommendations based on individual data
- Never provide generic linear plans - always adapt to the runner's specific situation
- Focus on the "why" behind recommendations, not just the "what"
- Acknowledge limitations and suggest professional medical consultation when appropriate
- Be direct, supportive, and data-informed

Current runner's context:
%s%s%s

Provide concise, actionable advice. Keep responses to 2-3 paragraphs unless the runner asks for more detail.%s`,
		trainingContext, modeInstruction, coachRuleLayer, artifactInstr)

	log := logger.FromContext(ctx)
	var response string
	if s.config.GeminiAPIKey != "" {
		log.Info("[Coach] Calling Gemini API",
			"messages", len(messages), "mode", normalizedMode, "intent", intent)
		response, err = s.callGeminiAPI(messages, systemPrompt)
	} else if s.config.ClaudeAPIKey != "" {
		log.Info("[Coach] Calling Claude API",
			"messages", len(messages), "mode", normalizedMode, "intent", intent)
		response, err = s.callClaudeAPI(messages, systemPrompt)
	} else {
		return "", nil, nil, "", errors.New("no AI API key configured — please set GEMINI_API_KEY in your .env file")
	}
	if err != nil {
		log.Error("[Coach] AI API error", "error", err)
		return "", nil, nil, "", err
	}
	log.Info("[Coach] Got response", "chars", len(response))

	// Extract structured artifact from response (strips artifact block from stored text)
	cleanResponse, artifact := extractArtifact(response)

	// Persist any flagged concern to coach_state for cross-session continuity.
	s.persistCoachStateAsync(ctx, userID, cleanResponse)

	// Build evidence data points when there is no structured artifact.
	// Two fast DB reads, no AI call — used for the "Why?" expander in the UI.
	var evidence []EvidenceItem
	if artifact == nil {
		evidence = s.buildEvidenceItems(ctx, userID)
	}

	now := time.Now()
	userMsg := &models.CoachConversation{
		ID: uuid.New(), UserID: userID, Role: "user",
		Content: userMessage, CreatedAt: now, SessionID: sessionID,
	}
	assistantMsg := &models.CoachConversation{
		ID: uuid.New(), UserID: userID, Role: "assistant",
		Content: cleanResponse, CreatedAt: now.Add(time.Millisecond), SessionID: sessionID,
	}

	insertQuery := `
		INSERT INTO coach_conversations (id, user_id, role, content, created_at, session_id)
		VALUES (:id, :user_id, :role, :content, :created_at, :session_id)
	`
	_, _ = s.db.NamedExecContext(ctx, insertQuery, userMsg)
	_, _ = s.db.NamedExecContext(ctx, insertQuery, assistantMsg)

	var generatedTitle string
	if sessionID != nil {
		var count int
		if dbErr := s.db.GetContext(ctx, &count, `
			SELECT COUNT(*) FROM coach_conversations WHERE session_id = $1 AND role = 'user'
		`, *sessionID); dbErr == nil && count == 1 {
			generatedTitle = s.GenerateSessionTitle(ctx, userMessage)
			summary := sessionSummary(cleanResponse)
			_, _ = s.db.ExecContext(ctx, `
				UPDATE coach_sessions SET title = $1, summary = $2, updated_at = NOW() WHERE id = $3
			`, generatedTitle, summary, *sessionID)
		}
	}

	return cleanResponse, artifact, evidence, generatedTitle, nil
}

// callClaudeAPI calls the Anthropic Claude API
func (s *CoachService) callClaudeAPI(messages []ChatMessage, systemPrompt string) (string, error) {
	reqBody := ClaudeRequest{
		Model:     "claude-sonnet-4-5-20250929",
		MaxTokens: 2048,
		Messages:  messages,
		System:    systemPrompt,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", s.config.ClaudeAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Error("[Coach] HTTP request to Claude failed", "error", err)
		return "", fmt.Errorf("failed to reach AI service: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Error("[Coach] Claude API non-OK status",
			"status", resp.StatusCode, "body", string(body))
		return "", fmt.Errorf("AI service error (status %d)", resp.StatusCode)
	}

	var claudeResp ClaudeResponse
	if err := json.NewDecoder(resp.Body).Decode(&claudeResp); err != nil {
		return "", err
	}

	if len(claudeResp.Content) == 0 {
		return "", errors.New("no response from Claude")
	}

	return claudeResp.Content[0].Text, nil
}

// callGeminiAPI calls the Google Gemini API
func (s *CoachService) callGeminiAPI(messages []ChatMessage, systemPrompt string) (string, error) {
	// Convert messages to Gemini format (Gemini uses "model" instead of "assistant")
	var contents []GeminiContent
	for _, msg := range messages {
		role := msg.Role
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, GeminiContent{
			Role:  role,
			Parts: []GeminiPart{{Text: msg.Content}},
		})
	}

	reqBody := GeminiRequest{
		Contents: contents,
		SystemInstruction: &GeminiContent{
			Parts: []GeminiPart{{Text: systemPrompt}},
		},
		GenerationConfig: &GeminiGenConfig{
			MaxOutputTokens: 2048,
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=%s", s.config.GeminiAPIKey)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		slog.Error("[Coach] HTTP request to Gemini failed", "error", err)
		return "", fmt.Errorf("failed to reach AI service: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Error("[Coach] Gemini API non-OK status",
			"status", resp.StatusCode, "body", string(body))
		return "", fmt.Errorf("AI service error (status %d)", resp.StatusCode)
	}

	var geminiResp GeminiResponse
	if err := json.NewDecoder(resp.Body).Decode(&geminiResp); err != nil {
		return "", err
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return "", errors.New("no response from Gemini")
	}

	return geminiResp.Candidates[0].Content.Parts[0].Text, nil
}

// buildTrainingContext builds a context string from user's training data
func (s *CoachService) buildTrainingContext(ctx context.Context, userID uuid.UUID) (string, error) {
	var parts []string

	profileStr := ""
	if s.userProfileService != nil {
		if p, err := s.userProfileService.GetOrCreateProfile(ctx, userID); err == nil && p.DisplayName != nil {
			profileStr += fmt.Sprintf("Runner Name: %s\n", *p.DisplayName)
		}

		if prs, err := s.userProfileService.GetPersonalRecords(ctx, userID); err == nil && len(prs) > 0 {
			prs = limitContextItems(prs, maxContextPersonalRecords)
			profileStr += "Personal Records:\n"
			for _, pr := range prs {
				profileStr += fmt.Sprintf("- %s: %s\n", pr.Label, formatTime(&pr.TimeSeconds))
			}
		}

		if zones, err := s.userProfileService.GetTrainingZones(ctx, userID, "hr"); err == nil && len(zones) > 0 {
			zones = limitContextItems(zones, maxContextTrainingZones)
			profileStr += "Current HR Training Zones:\n"
			for _, z := range zones {
				minV := 0
				if z.MinValue != nil {
					minV = *z.MinValue
				}
				maxV := "Max"
				if z.MaxValue != nil {
					maxV = fmt.Sprintf("%d", *z.MaxValue)
				}
				lbl := ""
				if z.Label != nil {
					lbl = " (" + *z.Label + ")"
				}
				profileStr += fmt.Sprintf("- Z%d%s: %d - %s bpm\n", z.ZoneNumber, lbl, minV, maxV)
			}
		}
	}
	if profileStr != "" {
		parts = append(parts, profileStr)
	}

	// Get active goal (optional — coach still works without one)
	goal, err := s.goalsService.GetActiveGoal(ctx, userID)
	if err != nil {
		parts = append(parts, "Race Goal: No active race goal set yet.")
	} else {
		daysUntil := int(time.Until(goal.RaceDate).Hours() / 24)
		weeksOut := daysUntil / 7
		trainingPhase := "Build"
		switch {
		case weeksOut <= 1:
			trainingPhase = "Race Week"
		case weeksOut <= 3:
			trainingPhase = "Taper"
		case weeksOut <= 6:
			trainingPhase = "Peak"
		}
		parts = append(parts, fmt.Sprintf(`Race Goal: %s on %s (%d days away)
Distance: %.2f km
Target Time: %s
Training Phase: %s`,
			goal.RaceName,
			goal.RaceDate.Format("2006-01-02"),
			daysUntil,
			float64(goal.RaceDistanceMeters)/1000.0,
			formatTime(goal.TargetTimeSeconds),
			trainingPhase,
		))
	}

	// Get recent activities (last 42 days) — used for metrics and activity summary
	var activities []models.Activity
	query := `
		SELECT * FROM activities
		WHERE user_id = $1 AND start_time >= NOW() - INTERVAL '42 days'
		ORDER BY start_time DESC
	`
	err = s.db.SelectContext(ctx, &activities, query, userID)
	if err != nil {
		activities = []models.Activity{}
	}
	activities = limitContextItems(activities, maxContextActivities)

	// Compute current training state from activities
	if len(activities) > 0 {
		loadResult := metrics.CalculateATLCTL(activities, 0, 0)
		recoveryResult := metrics.RecoveryStatus(activities, 0, 0)
		injuryResult := metrics.InjuryRisk(activities, loadResult.ATL, loadResult.CTL)
		parts = append(parts, fmt.Sprintf(
			"Current Training State: Recovery %d%% (%s) · Injury Risk: %s · Form (TSB): %.1f",
			int(recoveryResult.RecoveryPct),
			recoveryResult.NextQualityDay,
			injuryResult.RiskLevel,
			loadResult.TSB,
		))
	}

	// Last 2 coach session summaries for continuity
	var sessionSummaries []string
	if dbErr := s.db.SelectContext(ctx, &sessionSummaries, `
		SELECT summary FROM coach_sessions
		WHERE user_id = $1 AND summary IS NOT NULL AND summary != ''
		ORDER BY updated_at DESC LIMIT 2
	`, userID); dbErr == nil && len(sessionSummaries) > 0 {
		sessionSummaries = limitContextItems(sessionSummaries, maxContextSessionSummaries)
		for i, sum := range sessionSummaries {
			label := "Last Coach Session"
			if i == 1 {
				label = "Previous Coach Session"
			}
			parts = append(parts, label+": "+sum)
		}
	}

	// Flagged concerns from coach_state (persisted across sessions)
	var stateJSON []byte
	if dbErr := s.db.GetContext(ctx, &stateJSON, `
		SELECT COALESCE(coach_state, '{}') FROM users WHERE id = $1
	`, userID); dbErr == nil && len(stateJSON) > 0 {
		var state coachState
		if jsonErr := json.Unmarshal(stateJSON, &state); jsonErr == nil && len(state.FlaggedConcerns) > 0 {
			flaggedConcerns := limitContextItems(state.FlaggedConcerns, maxContextFlaggedConcerns)
			concernLines := "Previously flagged concerns:"
			for _, c := range flaggedConcerns {
				concernLines += fmt.Sprintf("\n- %s (%s)", c.Text, c.Date)
			}
			parts = append(parts, concernLines)
		}
	}

	if len(activities) > 0 {
		type typeSummary struct {
			count    int
			distance float64
			duration int
		}
		byType := map[string]*typeSummary{}
		for _, act := range activities {
			ts, ok := byType[act.ActivityType]
			if !ok {
				ts = &typeSummary{}
				byType[act.ActivityType] = ts
			}
			ts.count++
			ts.distance += act.DistanceMeters
			ts.duration += act.DurationSeconds
		}

		activityLines := "Recent Activities (last 6 weeks):"
		for actType, ts := range byType {
			if models.DistanceBasedTypes[actType] {
				distKm := ts.distance / 1000.0
				var paceStr string
				if ts.distance > 0 {
					paceSeconds := float64(ts.duration) / distKm
					paceMin := int(paceSeconds) / 60
					paceSec := int(paceSeconds) % 60
					paceStr = fmt.Sprintf(", avg pace %d:%02d/km", paceMin, paceSec)
				}
				activityLines += fmt.Sprintf(
					"\n- %d %s (%.1f km%s)",
					ts.count, actType, distKm, paceStr,
				)
			} else {
				avgMinutes := 0
				if ts.count > 0 {
					avgMinutes = (ts.duration / ts.count) / 60
				}
				activityLines += fmt.Sprintf(
					"\n- %d %s (%d min avg)",
					ts.count, actType, avgMinutes,
				)
			}
		}
		parts = append(parts, activityLines)
	} else {
		parts = append(parts, "Recent Training: No activities recorded in the last 6 weeks.")
	}

	// Weekly summaries (last 6 weeks)
	var summaries []models.WeeklySummary
	summaryQuery := `
		SELECT * FROM weekly_summaries
		WHERE user_id = $1
		ORDER BY week_start DESC
		LIMIT 6
	`
	err = s.db.SelectContext(ctx, &summaries, summaryQuery, userID)
	if err == nil && len(summaries) > 0 {
		summaries = limitContextItems(summaries, maxContextWeeklySummaries)
		weeklyInfo := "Weekly Summaries (recent weeks):"
		for _, ws := range summaries {
			distKm := ws.TotalDistanceMeters / 1000.0
			longestKm := 0.0
			if ws.LongestRunMeters != nil {
				longestKm = *ws.LongestRunMeters / 1000.0
			}
			weeklyInfo += fmt.Sprintf("\n- Week of %s: %.1f km across %d runs, avg pace %.0f s/km, longest run %.1f km",
				ws.WeekStart.Format("Jan 2"),
				distKm,
				ws.RunCount,
				ws.AveragePaceSecondsPerKm,
				longestKm,
			)
		}
		parts = append(parts, weeklyInfo)

		// Trend direction
		if len(summaries) >= 2 {
			thisWeek := summaries[0].TotalDistanceMeters
			prevAvg := 0.0
			for i := 1; i < len(summaries) && i <= 3; i++ {
				prevAvg += summaries[i].TotalDistanceMeters
			}
			count := float64(len(summaries) - 1)
			if count > 3 {
				count = 3
			}
			if count > 0 {
				prevAvg /= count
			}
			if prevAvg > 0 {
				ratio := thisWeek / prevAvg
				trend := "stable"
				if ratio > 1.1 {
					trend = "increasing"
				} else if ratio < 0.8 {
					trend = "decreasing"
				}
				parts = append(parts, fmt.Sprintf("Volume Trend: %s (this week %.1f km vs avg %.1f km)", trend, thisWeek/1000, prevAvg/1000))
			}
		}

		// Consistency metric
		consistentWeeks := 0
		for i := 0; i < len(summaries) && i < 4; i++ {
			if summaries[i].RunCount >= 3 {
				consistentWeeks++
			}
		}
		parts = append(parts, fmt.Sprintf("Consistency: %d out of last %d weeks had 3+ runs", consistentWeeks, min(len(summaries), 4)))
	}

	// Longest run in last 3 weeks
	var longestRun float64
	longestQuery := `SELECT COALESCE(MAX(distance_meters), 0) FROM activities WHERE user_id = $1 AND start_time >= NOW() - INTERVAL '21 days'`
	_ = s.db.GetContext(ctx, &longestRun, longestQuery, userID)
	if longestRun > 0 {
		parts = append(parts, fmt.Sprintf("Longest Run (last 3 weeks): %.1f km", longestRun/1000))
	}

	// Upcoming calendar entries (next 7 days)
	if s.calendarService != nil {
		now := time.Now()
		upcoming, calErr := s.calendarService.GetWeekEntries(ctx, userID, now)
		if calErr == nil && len(upcoming) > 0 {
			upcoming = limitContextItems(upcoming, maxContextUpcomingEntries)
			calInfo := "Upcoming Planned Workouts (next 7 days):"
			for _, entry := range upcoming {
				distInfo := ""
				if entry.PlannedDistanceMeters != nil {
					distInfo = fmt.Sprintf(", %.1f km", float64(*entry.PlannedDistanceMeters)/1000)
				}
				calInfo += fmt.Sprintf("\n- %s: %s (%s%s)", entry.Date.Format("Mon Jan 2"), entry.Title, entry.WorkoutType, distInfo)
			}
			parts = append(parts, calInfo)
		}
	}

	contextStr := ""
	for i, part := range parts {
		if i > 0 {
			contextStr += "\n"
		}
		contextStr += part
	}

	return contextStr, nil
}

// GenerateSessionTitle calls the AI to produce a short ≤6-word session title.
// Falls back to text truncation if the AI call fails or returns nothing useful.
func (s *CoachService) GenerateSessionTitle(ctx context.Context, userMessage string) string {
	prompt := fmt.Sprintf(
		"Write a 3-5 word title for a running coaching conversation that begins with:\n%q\nReply with ONLY the title. No quotes, no trailing punctuation.",
		userMessage,
	)
	msgs := []ChatMessage{{Role: "user", Content: prompt}}
	system := "You write short, descriptive titles for running coach conversations."

	var (
		title string
		err   error
	)
	if s.config.GeminiAPIKey != "" {
		title, err = s.callGeminiAPI(msgs, system)
	} else if s.config.ClaudeAPIKey != "" {
		title, err = s.callClaudeAPI(msgs, system)
	}

	if err != nil || strings.TrimSpace(title) == "" {
		return sessionTitle(userMessage)
	}

	title = strings.TrimSpace(title)
	title = strings.Trim(title, `"'`)
	if words := strings.Fields(title); len(words) > 6 {
		title = strings.Join(words[:6], " ")
	}
	return title
}

// sessionTitle derives a short sidebar title from the user's first message.
// It prefers a natural sentence boundary (?) over raw truncation.
func sessionTitle(msg string) string {
	msg = strings.TrimSpace(msg)
	const maxRunes = 50
	runes := []rune(msg)
	if len(runes) <= maxRunes {
		return msg
	}
	// End at a question mark if it falls within a reasonable length
	if idx := strings.IndexByte(msg, '?'); idx > 0 && idx <= 60 {
		return msg[:idx+1]
	}
	// Word-boundary truncation
	candidate := string(runes[:maxRunes])
	if lastSpace := strings.LastIndex(candidate, " "); lastSpace > 20 {
		return candidate[:lastSpace] + "…"
	}
	return candidate + "…"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// formatTime formats seconds into HH:MM:SS
func formatTime(seconds *int) string {
	if seconds == nil {
		return "Just finish"
	}
	s := *seconds
	hours := s / 3600
	minutes := (s % 3600) / 60
	secs := s % 60
	return fmt.Sprintf("%d:%02d:%02d", hours, minutes, secs)
}

// GenerateInsight generates a short daily coaching insight for the dashboard sidebar.
// The result is cached in Redis for the rest of the day to avoid redundant AI calls.
func (s *CoachService) GenerateInsight(ctx context.Context, userID uuid.UUID) (string, error) {
	today := time.Now().UTC().Format("2006-01-02")
	cacheKey := fmt.Sprintf("insight:%s:%s", userID.String(), today)

	if s.rdb != nil {
		if cached, err := s.rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			return cached, nil
		}
	}

	trainingContext, err := s.buildTrainingContext(ctx, userID)
	if err != nil {
		trainingContext = "No training data available yet."
	}

	systemPrompt := fmt.Sprintf(`You are Korsana, an experienced running coach. Generate a brief, actionable daily coaching insight for the runner's dashboard.

Current runner's context:
%s

Rules:
- Keep it to 1-2 sentences max
- Be specific and data-informed when possible
- Focus on what they should do today or this week
- Use a direct, supportive tone
- Never be generic — reference their actual training data or goal
- If they have no data, encourage them to get started`, trainingContext)

	messages := []ChatMessage{
		{Role: "user", Content: "Give me a brief coaching insight for my dashboard today."},
	}

	var response string
	if s.config.GeminiAPIKey != "" {
		response, err = s.callGeminiAPI(messages, systemPrompt)
	} else if s.config.ClaudeAPIKey != "" {
		response, err = s.callClaudeAPI(messages, systemPrompt)
	} else {
		return "", errors.New("no AI API key configured")
	}

	if err != nil {
		return "", err
	}

	if s.rdb != nil && response != "" {
		ttl := time.Until(time.Now().UTC().Truncate(24 * time.Hour).Add(25 * time.Hour))
		s.rdb.Set(ctx, cacheKey, response, ttl)
	}

	return response, nil
}

// PlanEntry represents a single day's workout in a generated plan
type PlanEntry struct {
	Date        string  `json:"date"`
	WorkoutType string  `json:"workout_type"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	DistanceKm  float64 `json:"distance_km"`
	PacePerKm   int     `json:"pace_per_km"`
}

// PlanResponse is the structured response from the AI for plan generation
type PlanResponse struct {
	Plan    []PlanEntry `json:"plan"`
	Summary string      `json:"summary"`
}

// GeneratePlan generates a training plan and optionally writes it to the calendar
func (s *CoachService) GeneratePlan(ctx context.Context, userID uuid.UUID, days int) (*PlanResponse, error) {
	trainingContext, err := s.buildTrainingContext(ctx, userID)
	if err != nil {
		trainingContext = "No training data available yet."
	}

	if days <= 0 || days > 14 {
		days = 7
	}

	// Build dates for the plan
	now := time.Now()
	dateList := ""
	for i := 0; i < days; i++ {
		d := now.AddDate(0, 0, i+1)
		dateList += fmt.Sprintf("- %s (%s)\n", d.Format("2006-01-02"), d.Format("Monday"))
	}

	systemPrompt := fmt.Sprintf(`You are Korsana, an expert running coach. Generate a structured training plan.

Runner's context:
%s

IMPORTANT: You MUST respond with ONLY a valid JSON object in this exact format, no markdown, no extra text:
{
  "plan": [
    {
      "date": "YYYY-MM-DD",
      "workout_type": "easy|tempo|interval|long|recovery|rest|race|cross_train",
      "title": "Workout Title",
      "description": "Brief description of the workout",
      "distance_km": 8.0,
      "pace_per_km": 360
    }
  ],
  "summary": "Brief 1-2 sentence summary of the plan"
}

Rules:
- Generate exactly one entry per date listed below
- Use appropriate workout_type values
- distance_km should be 0 for rest days
- pace_per_km is in seconds (e.g., 360 = 6:00/km)
- Balance easy/hard days (80/20 rule)
- Include at least 1 rest day per week
- Adapt to the runner's current fitness level and goal

Dates to plan:
%s`, trainingContext, dateList)

	messages := []ChatMessage{
		{Role: "user", Content: fmt.Sprintf("Generate a %d-day training plan for me starting tomorrow. Respond with ONLY the JSON.", days)},
	}

	var response string
	if s.config.GeminiAPIKey != "" {
		response, err = s.callGeminiAPI(messages, systemPrompt)
	} else if s.config.ClaudeAPIKey != "" {
		response, err = s.callClaudeAPI(messages, systemPrompt)
	} else {
		return nil, errors.New("no AI API key configured")
	}
	if err != nil {
		return nil, err
	}

	// Strip markdown code fences if present
	response = stripCodeFences(response)

	// Parse JSON response
	var planResp PlanResponse
	if err := json.Unmarshal([]byte(response), &planResp); err != nil {
		logger.FromContext(ctx).Error("[Coach] Failed to parse plan JSON",
			"error", err, "raw_response", response)
		return nil, fmt.Errorf("failed to parse AI plan response: %v", err)
	}

	return &planResp, nil
}

// WritePlanToCalendar writes a generated plan to the training calendar
func (s *CoachService) WritePlanToCalendar(ctx context.Context, userID uuid.UUID, plan []PlanEntry) error {
	if s.calendarService == nil {
		return errors.New("calendar service not available")
	}

	for _, entry := range plan {
		entryDate, err := time.Parse("2006-01-02", entry.Date)
		if err != nil {
			continue
		}

		distMeters := int(entry.DistanceKm * 1000)
		desc := entry.Description

		calEntry := &models.CalendarEntry{
			Date:                  entryDate,
			WorkoutType:           entry.WorkoutType,
			Title:                 entry.Title,
			Description:           &desc,
			PlannedDistanceMeters: &distMeters,
			PlannedPacePerKm:      &entry.PacePerKm,
			Status:                "planned",
			Source:                "ai_coach",
		}

		if _, err := s.calendarService.CreateEntry(ctx, userID, calEntry); err != nil {
			logger.FromContext(ctx).Error("[Coach] Failed to write calendar entry",
				"date", entry.Date, "error", err)
		}
	}

	return nil
}

// stripCodeFences removes markdown code fences from AI responses
func stripCodeFences(s string) string {
	result := strings.TrimSpace(s)
	// Remove ```json ... ``` or ``` ... ```
	for _, prefix := range []string{"```json\n", "```json", "```\n", "```"} {
		if len(result) > len(prefix) && result[:len(prefix)] == prefix {
			result = result[len(prefix):]
			break
		}
	}
	result = strings.TrimSpace(result)
	if len(result) >= 3 && result[len(result)-3:] == "```" {
		result = result[:len(result)-3]
	}
	return strings.TrimSpace(result)
}

// GetConversationHistory retrieves the conversation history for a user.
// Limit is clamped to coachListRowCap so a runaway caller can't pull
// unbounded rows.
func (s *CoachService) GetConversationHistory(ctx context.Context, userID uuid.UUID, limit int) ([]models.CoachConversation, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > coachListRowCap {
		limit = coachListRowCap
	}

	var messages []models.CoachConversation
	query := `
		SELECT * FROM coach_conversations
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`
	err := s.db.SelectContext(ctx, &messages, query, userID, limit)
	if err != nil {
		return nil, err
	}

	// Reverse to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}
