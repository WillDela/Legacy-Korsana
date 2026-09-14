package strava

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	baseURL  = "https://www.strava.com/api/v3"
	authURL  = "https://www.strava.com/oauth/authorize"
	tokenURL = "https://www.strava.com/oauth/token"
	scope    = "read,activity:read_all,profile:read_all"
)

// Client handles Strava API communication
type Client struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	HTTPClient   *http.Client
}

// APIError captures Strava API failures with enough detail for bounded retry logic.
type APIError struct {
	StatusCode int
	RetryAfter time.Duration
	Body       string
}

func (e *APIError) Error() string {
	if e == nil {
		return ""
	}
	if e.RetryAfter > 0 {
		return fmt.Sprintf("strava api returned status %d (retry after %s): %s", e.StatusCode, e.RetryAfter, e.Body)
	}
	return fmt.Sprintf("strava api returned status: %d: %s", e.StatusCode, e.Body)
}

func parseRetryAfter(header string) time.Duration {
	header = strings.TrimSpace(header)
	if header == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(header); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(header); err == nil {
		delay := time.Until(when)
		if delay > 0 {
			return delay
		}
	}
	return 0
}

func readAPIError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return &APIError{
		StatusCode: resp.StatusCode,
		RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After")),
		Body:       strings.TrimSpace(string(body)),
	}
}

// NewClient creates a new Strava API client
func NewClient(clientID, clientSecret, redirectURI string) *Client {
	return &Client{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  redirectURI,
		HTTPClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

// TokenResponse represents the OAuth token response
type TokenResponse struct {
	TokenType    string `json:"token_type"`
	AccessToken  string `json:"access_token"`
	ExpiresAt    int64  `json:"expires_at"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Athlete      struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		FirstName string `json:"firstname"`
		LastName  string `json:"lastname"`
	} `json:"athlete"`
}

// GetAuthorizationURL returns the URL to redirect users to for Strava OAuth
func (c *Client) GetAuthorizationURL(state string) string {
	params := url.Values{}
	params.Add("client_id", c.ClientID)
	params.Add("response_type", "code")
	params.Add("redirect_uri", c.RedirectURI)
	params.Add("approval_prompt", "force")
	params.Add("scope", scope)
	if state != "" {
		params.Add("state", state)
	}

	return fmt.Sprintf("%s?%s", authURL, params.Encode())
}

// ExchangeToken exchanges the authorization code for an access token
func (c *Client) ExchangeToken(code string) (*TokenResponse, error) {
	params := url.Values{}
	params.Add("client_id", c.ClientID)
	params.Add("client_secret", c.ClientSecret)
	params.Add("code", code)
	params.Add("grant_type", "authorization_code")

	resp, err := c.HTTPClient.PostForm(tokenURL, params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, readAPIError(resp)
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	return &tokenResp, nil
}

// Activity represents a Strava activity response
type Activity struct {
	ID                 int64   `json:"id"`
	Name               string  `json:"name"`
	Distance           float64 `json:"distance"`             // meters
	MovingTime         int     `json:"moving_time"`          // seconds
	ElapsedTime        int     `json:"elapsed_time"`         // seconds
	TotalElevationGain float64 `json:"total_elevation_gain"` // meters
	Type               string  `json:"type"`                 // "Run", "Ride", etc.
	SportType          string  `json:"sport_type"`
	StartDate          string  `json:"start_date"`       // ISO 8601 UTC
	StartDateLocal     string  `json:"start_date_local"` // ISO 8601 athlete's local time
	AverageHeartrate   float64 `json:"average_heartrate"`
	MaxHeartrate       float64 `json:"max_heartrate"`
	AverageCadence     float64 `json:"average_cadence"`
	SufferScore        float64 `json:"suffer_score"`
}

// GetActivities fetches recent activities for the authenticated athlete
func (c *Client) GetActivities(ctx context.Context, accessToken string, page int, perPage int) ([]Activity, error) {
	if perPage == 0 {
		perPage = 30
	}
	if page == 0 {
		page = 1
	}

	url := fmt.Sprintf("%s/athlete/activities?page=%d&per_page=%d", baseURL, page, perPage)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", accessToken))

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, readAPIError(resp)
	}

	var activities []Activity
	if err := json.NewDecoder(resp.Body).Decode(&activities); err != nil {
		return nil, err
	}

	return activities, nil
}

// RefreshToken refreshes an expired access token
func (c *Client) RefreshToken(ctx context.Context, refreshToken string) (*TokenResponse, error) {
	params := url.Values{}
	params.Add("client_id", c.ClientID)
	params.Add("client_secret", c.ClientSecret)
	params.Add("refresh_token", refreshToken)
	params.Add("grant_type", "refresh_token")

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, readAPIError(resp)
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	return &tokenResp, nil
}
