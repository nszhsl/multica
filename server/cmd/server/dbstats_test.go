package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// applyPoolSizing mirrors the env+URL precedence logic in newDBPool but
// without actually opening a connection, so the resolution rules can be
// asserted in unit tests.
func applyPoolSizing(t *testing.T, dbURL string, envMax, envMin string) (max, min int32) {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	urlParams := poolParamsFromURL(dbURL)

	if envMax != "" {
		t.Setenv("DATABASE_MAX_CONNS", envMax)
		cfg.MaxConns = envInt32("DATABASE_MAX_CONNS", cfg.MaxConns)
	} else if !urlParams["pool_max_conns"] {
		cfg.MaxConns = defaultMaxConns
	}

	if envMin != "" {
		t.Setenv("DATABASE_MIN_CONNS", envMin)
		cfg.MinConns = envInt32("DATABASE_MIN_CONNS", cfg.MinConns)
	} else if !urlParams["pool_min_conns"] {
		cfg.MinConns = defaultMinConns
	}

	if cfg.MinConns > cfg.MaxConns {
		cfg.MinConns = cfg.MaxConns
	}
	return cfg.MaxConns, cfg.MinConns
}

func TestPoolSizing_DefaultsWhenNothingSet(t *testing.T) {
	max, min := applyPoolSizing(t, "postgres://u:p@h/db?sslmode=disable", "", "")
	if max != defaultMaxConns || min != defaultMinConns {
		t.Fatalf("got max=%d min=%d, want %d/%d", max, min, defaultMaxConns, defaultMinConns)
	}
}

func TestPoolSizing_URLParamsHonoredWhenEnvUnset(t *testing.T) {
	url := "postgres://u:p@h/db?sslmode=disable&pool_max_conns=40&pool_min_conns=8"
	max, min := applyPoolSizing(t, url, "", "")
	if max != 40 || min != 8 {
		t.Fatalf("URL params should win when env unset; got max=%d min=%d", max, min)
	}
}

func TestPoolSizing_EnvOverridesURL(t *testing.T) {
	url := "postgres://u:p@h/db?sslmode=disable&pool_max_conns=40&pool_min_conns=8"
	max, min := applyPoolSizing(t, url, "100", "20")
	if max != 100 || min != 20 {
		t.Fatalf("env should win over URL; got max=%d min=%d", max, min)
	}
}

func TestPoolSizing_PartialURLParam(t *testing.T) {
	// Only pool_max_conns is set in URL — pool_min_conns should fall back to
	// the code default, not pgx's built-in default (which would be 0).
	url := "postgres://u:p@h/db?sslmode=disable&pool_max_conns=40"
	max, min := applyPoolSizing(t, url, "", "")
	if max != 40 {
		t.Fatalf("URL pool_max_conns should be honored; got max=%d", max)
	}
	if min != defaultMinConns {
		t.Fatalf("min should default; got min=%d, want %d", min, defaultMinConns)
	}
}

func TestPoolSizing_InvalidEnvFallsBack(t *testing.T) {
	// Invalid env value falls back to whatever was already on cfg (URL or
	// pgx default). With no URL param, that's the pgx default — but our
	// code path then keeps it as-is, since the env is non-empty. This
	// documents the chosen behavior so a future change is intentional.
	max, _ := applyPoolSizing(t, "postgres://u:p@h/db?sslmode=disable", "not-a-number", "")
	if max <= 0 {
		t.Fatalf("invalid env should not produce non-positive max_conns; got %d", max)
	}
}

func TestPoolSizing_MinClampedToMax(t *testing.T) {
	max, min := applyPoolSizing(t, "postgres://u:p@h/db?sslmode=disable", "10", "50")
	if min > max {
		t.Fatalf("min should be clamped to max; got max=%d min=%d", max, min)
	}
}
