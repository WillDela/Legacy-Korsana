package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/korsana/backend/internal/api/handlers"
	"github.com/korsana/backend/internal/api/middleware"
	"github.com/korsana/backend/internal/config"
	"github.com/korsana/backend/internal/database"
	"github.com/korsana/backend/internal/logger"
	"github.com/korsana/backend/internal/services"
	"github.com/korsana/backend/pkg/strava"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// shutdownTimeout bounds how long in-flight requests have to finish after a
// SIGINT/SIGTERM before the server is forcibly closed.
const shutdownTimeout = 15 * time.Second

func main() {
	// Load .env file (ignore error if not present, e.g. in production)
	_ = godotenv.Load()

	// 1. Load Configuration
	cfg, err := config.Load()
	if err != nil {
		// Logger isn't initialized yet — fall back to stderr.
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	// 2. Initialize Logger
	log := logger.Init(cfg.Environment, nil)

	// 3. Initialize Database
	db, err := database.NewPostgresDB(cfg.DatabaseURL)
	if err != nil {
		log.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}

	// 4. Initialize Redis
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Error("Failed to parse Redis URL", "error", err)
		os.Exit(1)
	}
	// Managed Redis providers such as Heroku Key-Value Store require TLS but
	// serve a self-signed certificate. ParseURL turns on verification for
	// rediss:// URLs, which then fails the handshake; skip verification while
	// keeping the connection encrypted. Plain redis:// URLs leave TLSConfig
	// nil and are unaffected.
	if opt.TLSConfig != nil {
		opt.TLSConfig.InsecureSkipVerify = true
	}
	redisClient := redis.NewClient(opt)

	// 4. Initialize External Clients
	stravaClient := strava.NewClient(cfg.StravaClientID, cfg.StravaClientSecret, cfg.StravaRedirectURI)

	// 5. Initialize Services
	authService := services.NewAuthService(db, cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
	calendarService := services.NewCalendarService(db)
	stravaService := services.NewStravaService(db, stravaClient, redisClient, calendarService)
	goalsService := services.NewGoalsService(db)
	activityService := services.NewActivityService(db)
	metricsService := services.NewMetricsService(db)
	crossTrainingGoalsService := services.NewCrossTrainingGoalsService(db)
	userProfileService := services.NewUserProfileService(db, cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
	notificationService := services.NewNotificationService(
		db,
		cfg.FrontendURL,
		cfg.SMTPHost,
		cfg.SMTPPort,
		cfg.SMTPUsername,
		cfg.SMTPPassword,
		cfg.SMTPFromEmail,
		cfg.SMTPFromName,
	)
	integrationsService := services.NewIntegrationsService(db)
	coachService := services.NewCoachService(db, redisClient, cfg, goalsService, calendarService, userProfileService)

	// 6. Initialize Handlers
	stravaHandler := handlers.NewStravaHandler(stravaService, authService, userProfileService, notificationService, cfg.FrontendURL)
	goalsHandler := handlers.NewGoalsHandler(goalsService)
	coachHandler := handlers.NewCoachHandler(coachService, db)
	calendarHandler := handlers.NewCalendarHandler(calendarService)
	profileHandler := handlers.NewProfileHandler(authService, stravaService, goalsService, userProfileService, notificationService, integrationsService)
	activitiesHandler := handlers.NewActivitiesHandler(activityService)
	dashboardHandler := handlers.NewDashboardHandler(metricsService)
	crossTrainingHandler := handlers.NewCrossTrainingHandler(db)
	gearHandler := handlers.NewGearHandler(db)
	predictorHandler := handlers.NewPredictorHandler(db)
	crossTrainingGoalsHandler := handlers.NewCrossTrainingGoalsHandler(crossTrainingGoalsService)

	// 6. Setup Router
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger())

	// CORS Configuration
	origins, err := parseAllowedOrigins(cfg.AllowedOrigins)
	if err != nil {
		log.Error("Invalid ALLOWED_ORIGINS", "error", err)
		os.Exit(1)
	}
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = origins
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(corsConfig))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		if err := db.Health(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// API Routes
	api := r.Group("/api")
	{
		// Strava OAuth callback (public — Strava redirects here after user approves)
		api.GET("/strava/callback", stravaHandler.Callback)

		// Protected Routes
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(cfg))
		{
			// Strava
			strava := protected.Group("/strava")
			{
				strava.GET("/auth", stravaHandler.AuthURL)
				strava.POST("/sync", stravaHandler.SyncActivities)
				strava.GET("/activities", stravaHandler.GetActivities)
				strava.DELETE("", stravaHandler.Disconnect)
			}

			// Race Goals
			goals := protected.Group("/goals")
			{
				goals.POST("", goalsHandler.CreateGoal)
				goals.GET("", goalsHandler.GetGoals)
				goals.GET("/active", goalsHandler.GetActiveGoal)
				goals.GET("/:id", goalsHandler.GetGoal)
				goals.PUT("/:id", goalsHandler.UpdateGoal)
				goals.PUT("/:id/active", goalsHandler.SetActive)
				goals.PUT("/:id/result", goalsHandler.LogResult)
				goals.DELETE("/:id", goalsHandler.DeleteGoal)
			}

			// AI Coach
			coach := protected.Group("/coach")
			{
				coachLimiter := middleware.CoachRateLimiter(redisClient, db)
				insightLimiter := middleware.InsightRateLimiter(redisClient)
				coach.POST("/message", coachLimiter, coachHandler.SendMessage)
				coach.GET("/history", coachHandler.GetConversationHistory)
				coach.GET("/quota", coachHandler.GetQuota)
				coach.GET("/insight", insightLimiter, coachHandler.GetInsight)
				coach.POST("/generate-plan", coachLimiter, coachHandler.GeneratePlan)
				// Sessions
				coach.POST("/sessions", coachHandler.CreateSession)
				coach.GET("/sessions", coachHandler.GetSessions)
				coach.GET("/sessions/:id/messages", coachHandler.GetSessionMessages)
			}

			// Profile / Settings
			profile := protected.Group("/profile")
			{
				profile.GET("", profileHandler.GetProfile)
				profile.PUT("", profileHandler.UpdateProfile)
				profile.DELETE("", profileHandler.DeleteAccount)
				profile.GET("/export", profileHandler.ExportData)
				profile.POST("/avatar", profileHandler.UploadAvatar)
				profile.POST("/notifications/test", profileHandler.SendTestNotification)
				profile.POST("/integrations/interest/:source", profileHandler.RequestIntegrationInterest)

				profile.GET("/prs", profileHandler.GetPersonalRecords)
				profile.PUT("/prs/:label", profileHandler.UpsertPersonalRecord)
				profile.DELETE("/prs/:label", profileHandler.DeletePersonalRecord)
				profile.POST("/prs/detect", profileHandler.DetectPRsFromStrava)

				profile.PUT("/email", profileHandler.UpdateEmail)
				profile.PUT("/password", profileHandler.ChangePassword)

				profile.GET("/zones", profileHandler.GetTrainingZones)
				profile.PUT("/zones", profileHandler.UpdateTrainingZones)
				profile.POST("/zones/calculate", profileHandler.CalculateZones)
			}

			// Training Calendar
			calendar := protected.Group("/calendar")
			{
				calendar.GET("/week", calendarHandler.GetWeek)
				calendar.GET("/range", calendarHandler.GetRange)
				calendar.POST("/entry", calendarHandler.CreateEntry)
				calendar.PUT("/entry/:id", calendarHandler.UpdateEntry)
				calendar.DELETE("/entry/:id", calendarHandler.DeleteEntry)
				calendar.PATCH("/entry/:id/status", calendarHandler.UpdateStatus)
			}

			// Activities
			protected.POST("/activities", activitiesHandler.CreateActivity)
			protected.GET("/activities", activitiesHandler.GetActivities)
			protected.DELETE("/activities/:id", activitiesHandler.DeleteActivity)

			// Dashboard metrics
			protected.GET("/dashboard", dashboardHandler.Get)

			// Cross-training sessions
			protected.GET("/crosstraining", crossTrainingHandler.List)
			protected.POST("/crosstraining", crossTrainingHandler.Create)
			protected.DELETE("/crosstraining/:id", crossTrainingHandler.Delete)

			// Gear / Shoes
			protected.GET("/gear/shoes", gearHandler.ListShoes)
			protected.POST("/gear/shoes", gearHandler.AddShoe)
			protected.PUT("/gear/shoes/:id", gearHandler.UpdateShoe)
			protected.DELETE("/gear/shoes/:id", gearHandler.DeleteShoe)

			// Race Predictor manual override
			protected.POST("/predictor/manual", predictorHandler.SaveManual)

			// Cross-training goals
			ctg := protected.Group("/cross-training-goals")
			{
				ctg.GET("", crossTrainingGoalsHandler.GetGoals)
				ctg.PUT("", crossTrainingGoalsHandler.UpsertGoal)
				ctg.DELETE("/:id", crossTrainingGoalsHandler.DeleteGoal)
			}
		}
	}

	// Start Server with graceful shutdown
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Info("Korsana API server starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		if err != nil {
			log.Error("Server failed to start", "error", err)
			os.Exit(1)
		}
	case sig := <-quit:
		log.Info("Received signal, shutting down", "signal", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Error("Server forced to shutdown", "timeout", shutdownTimeout.String(), "error", err)
			os.Exit(1)
		}
		log.Info("Server stopped cleanly")
	}
}

// parseAllowedOrigins splits a comma-separated CORS origin list and validates
// each entry. Every origin must either be the wildcard "*" or a URL with an
// http/https scheme and a non-empty host. Returns an error pointing at the
// first malformed entry so typos are caught at startup rather than surfacing
// as confusing CORS failures in the browser.
func parseAllowedOrigins(raw string) ([]string, error) {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		o := strings.TrimSpace(p)
		if o == "" {
			continue
		}
		if o == "*" {
			origins = append(origins, o)
			continue
		}
		u, err := url.Parse(o)
		if err != nil {
			return nil, fmt.Errorf("origin %q is not a valid URL: %w", o, err)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return nil, fmt.Errorf("origin %q must use http or https scheme (got %q)", o, u.Scheme)
		}
		if u.Host == "" {
			return nil, fmt.Errorf("origin %q must include a host (e.g. https://example.com)", o)
		}
		origins = append(origins, o)
	}
	if len(origins) == 0 {
		return nil, errors.New("ALLOWED_ORIGINS must contain at least one origin")
	}
	return origins, nil
}
