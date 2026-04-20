package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Model describes a single LLM model exposed by an agent provider.
// The dropdown groups by Provider when the ID uses the
// `provider/model` form (e.g. "openai/gpt-4o" from opencode).
// Default marks the model the daemon falls back to when neither the
// per-agent field nor the MULTICA_<PROVIDER>_MODEL env var is set;
// the UI surfaces this with a badge so users can see what "leave
// empty" actually means before saving.
type Model struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Provider string `json:"provider,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

// modelCache memoizes dynamic discovery calls so repeated UI loads
// don't re-shell the agent CLI. Entries expire after cacheTTL.
type modelCacheEntry struct {
	models    []Model
	expiresAt time.Time
}

var (
	modelCacheMu sync.Mutex
	modelCache   = map[string]modelCacheEntry{}
)

const modelCacheTTL = 60 * time.Second

// ListModels returns the models supported by the given agent provider.
// For providers with a known static catalog it returns the baked-in
// list; for providers with a CLI discovery mechanism (opencode, pi,
// openclaw) it shells out with caching and falls back to the static
// list on failure.
//
// executablePath lets the caller point at a non-default binary; pass
// "" to use the provider's default name on PATH.
func ListModels(ctx context.Context, providerType, executablePath string) ([]Model, error) {
	switch providerType {
	case "claude":
		return claudeStaticModels(), nil
	case "codex":
		return codexStaticModels(), nil
	case "gemini":
		return geminiStaticModels(), nil
	case "cursor":
		return cursorStaticModels(), nil
	case "copilot":
		return copilotStaticModels(), nil
	case "hermes":
		// Hermes does not honour per-task model selection (model is
		// fixed via ~/.hermes/.env). ModelSelectionSupported returns
		// false for hermes so the UI disables the dropdown instead
		// of silently ignoring what the user types.
		return []Model{}, nil
	case "opencode":
		return cachedDiscovery(providerType, func() ([]Model, error) {
			return discoverOpenCodeModels(ctx, executablePath)
		})
	case "pi":
		return cachedDiscovery(providerType, func() ([]Model, error) {
			return discoverPiModels(ctx, executablePath)
		})
	case "openclaw":
		return cachedDiscovery(providerType, func() ([]Model, error) {
			return discoverOpenclawAgents(ctx, executablePath)
		})
	default:
		return nil, fmt.Errorf("unknown agent type: %q", providerType)
	}
}

// ModelSelectionSupported reports whether setting `agent.model` has
// any effect for the given provider. Returns false for providers
// that drive model selection through out-of-band configuration
// (currently hermes, which reads ~/.hermes/.env) — the UI uses this
// to disable its dropdown instead of silently accepting a value the
// backend will ignore.
func ModelSelectionSupported(providerType string) bool {
	switch providerType {
	case "hermes":
		return false
	default:
		return true
	}
}

// DefaultModel returns the provider's recommended default model ID,
// or "" if the provider has no opinionated default (copilot routes
// through GitHub; openclaw resolves agents at runtime; hermes
// configures models out-of-band). The daemon falls back to this
// value when both `agent.model` and MULTICA_<PROVIDER>_MODEL are
// empty, so the dropdown's "Default (provider)" empty state
// actually maps to a concrete model at execution time.
func DefaultModel(providerType string) string {
	for _, m := range defaultStaticModelsFor(providerType) {
		if m.Default {
			return m.ID
		}
	}
	return ""
}

// defaultStaticModelsFor returns the static catalog for provider
// types that have one. Used by both ListModels (via the per-provider
// helpers below) and DefaultModel; centralised so adding a new
// provider only requires editing one place.
func defaultStaticModelsFor(providerType string) []Model {
	switch providerType {
	case "claude":
		return claudeStaticModels()
	case "codex":
		return codexStaticModels()
	case "gemini":
		return geminiStaticModels()
	case "cursor":
		return cursorStaticModels()
	case "copilot":
		return copilotStaticModels()
	default:
		return nil
	}
}

// cachedDiscovery invokes fn and caches the result for modelCacheTTL.
// The cache is keyed on providerType only; callers that need to
// distinguish discovery by host/user should include that in the key
// if we ever introduce such a mode.
func cachedDiscovery(key string, fn func() ([]Model, error)) ([]Model, error) {
	modelCacheMu.Lock()
	if entry, ok := modelCache[key]; ok && time.Now().Before(entry.expiresAt) {
		out := entry.models
		modelCacheMu.Unlock()
		return out, nil
	}
	modelCacheMu.Unlock()

	models, err := fn()
	if err != nil {
		return nil, err
	}

	modelCacheMu.Lock()
	modelCache[key] = modelCacheEntry{models: models, expiresAt: time.Now().Add(modelCacheTTL)}
	modelCacheMu.Unlock()
	return models, nil
}

// ── Static catalogs ──

// claudeStaticModels reflects the Claude Code CLI's accepted --model
// values. Keep this list short and current; stale entries here
// mislead users more than they help. Default = Sonnet because it's
// the everyday workhorse (Opus is reserved for advisor-style flows).
func claudeStaticModels() []Model {
	return []Model{
		{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Provider: "anthropic", Default: true},
		{ID: "claude-opus-4-7", Label: "Claude Opus 4.7", Provider: "anthropic"},
		{ID: "claude-haiku-4-5-20251001", Label: "Claude Haiku 4.5", Provider: "anthropic"},
		{ID: "claude-opus-4-6", Label: "Claude Opus 4.6", Provider: "anthropic"},
		{ID: "claude-sonnet-4-5", Label: "Claude Sonnet 4.5", Provider: "anthropic"},
	}
}

func codexStaticModels() []Model {
	return []Model{
		{ID: "gpt-5.4", Label: "GPT-5.4", Provider: "openai", Default: true},
		{ID: "gpt-5.4-mini", Label: "GPT-5.4 mini", Provider: "openai"},
		{ID: "gpt-5.3-codex", Label: "GPT-5.3 Codex", Provider: "openai"},
		{ID: "gpt-5", Label: "GPT-5", Provider: "openai"},
		{ID: "o3", Label: "o3", Provider: "openai"},
		{ID: "o3-mini", Label: "o3-mini", Provider: "openai"},
	}
}

func geminiStaticModels() []Model {
	return []Model{
		{ID: "gemini-2.5-pro", Label: "Gemini 2.5 Pro", Provider: "google", Default: true},
		{ID: "gemini-2.5-flash", Label: "Gemini 2.5 Flash", Provider: "google"},
		{ID: "gemini-2.0-flash", Label: "Gemini 2.0 Flash", Provider: "google"},
	}
}

// cursorStaticModels mirrors the documented cursor-agent --model IDs.
// cursor-agent is itself a multi-provider wrapper, so this is an
// allowlist of known-good values rather than an exhaustive catalog.
// Default = composer-1.5 because that's cursor-agent's native model;
// the rest are alternative provider routings.
func cursorStaticModels() []Model {
	return []Model{
		{ID: "composer-1.5", Label: "Composer 1.5", Provider: "cursor", Default: true},
		{ID: "claude-opus-4-7", Label: "Claude Opus 4.7", Provider: "anthropic"},
		{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Provider: "anthropic"},
		{ID: "gpt-5.4", Label: "GPT-5.4", Provider: "openai"},
		{ID: "o3", Label: "o3", Provider: "openai"},
		{ID: "gemini-2.5-pro", Label: "Gemini 2.5 Pro", Provider: "google"},
	}
}

// copilotStaticModels — GitHub Copilot CLI resolves models via the
// user's GitHub account, not via CLI args. We deliberately mark no
// Default: the right model is whatever GitHub routes the request
// to, and forcing one here would override that.
func copilotStaticModels() []Model {
	return []Model{
		{ID: "gpt-5.4", Label: "GPT-5.4", Provider: "openai"},
		{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Provider: "anthropic"},
	}
}

// ── Dynamic discovery ──

// discoverOpenCodeModels runs `opencode models` and parses its tabular
// output. The CLI prints `provider/model` rows; we emit them verbatim
// as IDs so what the user sees matches what `--model` accepts.
// On any failure (CLI missing, parse error, timeout) we fall back to
// an empty list so the creatable UI still works.
func discoverOpenCodeModels(ctx context.Context, executablePath string) ([]Model, error) {
	if executablePath == "" {
		executablePath = "opencode"
	}
	if _, err := exec.LookPath(executablePath); err != nil {
		return []Model{}, nil
	}
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, executablePath, "models")
	out, err := cmd.Output()
	if err != nil {
		return []Model{}, nil
	}
	return parseOpenCodeModels(string(out)), nil
}

// parseOpenCodeModels accepts the `opencode models` text output and
// extracts IDs. Output format (v0.x): a header row followed by rows
// whose first whitespace-delimited field is `provider/model`.
func parseOpenCodeModels(output string) []Model {
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var models []Model
	seen := map[string]bool{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		first := strings.Fields(line)
		if len(first) == 0 {
			continue
		}
		id := first[0]
		if !strings.Contains(id, "/") {
			continue
		}
		// Skip the header row (opencode prints e.g. PROVIDER/MODEL in caps).
		if id == strings.ToUpper(id) {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		provider := ""
		if i := strings.Index(id, "/"); i > 0 {
			provider = id[:i]
		}
		models = append(models, Model{ID: id, Label: id, Provider: provider})
	}
	return models
}

// discoverPiModels runs `pi --list-models` and parses its output.
// Older pi versions print the list to stderr; newer versions use
// stdout. We capture both and parse whichever is non-empty.
func discoverPiModels(ctx context.Context, executablePath string) ([]Model, error) {
	if executablePath == "" {
		executablePath = "pi"
	}
	if _, err := exec.LookPath(executablePath); err != nil {
		return []Model{}, nil
	}
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, executablePath, "--list-models")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	stdout, err := cmd.Output()
	if err != nil {
		return []Model{}, nil
	}
	text := string(stdout)
	if strings.TrimSpace(text) == "" {
		text = stderr.String()
	}
	return parsePiModels(text), nil
}

// parsePiModels accepts the `pi --list-models` output and extracts
// model IDs. Pi's format uses `provider:model` rows; we normalize to
// the same `provider/model` form as opencode for UI consistency.
func parsePiModels(output string) []Model {
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var models []Model
	seen := map[string]bool{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		first := strings.Fields(line)
		if len(first) == 0 {
			continue
		}
		id := first[0]
		if !strings.ContainsAny(id, ":/") {
			continue
		}
		// Normalize ":" to "/" since pi uses colon but opencode/UI uses slash.
		id = strings.Replace(id, ":", "/", 1)
		if seen[id] {
			continue
		}
		seen[id] = true
		provider := ""
		if i := strings.Index(id, "/"); i > 0 {
			provider = id[:i]
		}
		models = append(models, Model{ID: id, Label: id, Provider: provider})
	}
	return models
}

// discoverOpenclawAgents enumerates the pre-registered OpenClaw
// agents (which is where model selection actually lives in the
// OpenClaw world — each agent is bound to a model at `agents add`
// time). It tries structured JSON output first, falling back to a
// conservative text parser that rejects TUI decoration and section
// headers. On any ambiguity we return an empty list and let the
// creatable dropdown handle manual entry — a silently-wrong
// enumeration would be worse than none.
func discoverOpenclawAgents(ctx context.Context, executablePath string) ([]Model, error) {
	if executablePath == "" {
		executablePath = "openclaw"
	}
	if _, err := exec.LookPath(executablePath); err != nil {
		return []Model{}, nil
	}
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// Try JSON modes first. Different openclaw builds expose the
	// flag under different names; trying a couple is cheap.
	for _, jsonArgs := range [][]string{
		{"agents", "list", "--json"},
		{"agents", "list", "--output", "json"},
		{"agents", "list", "-o", "json"},
	} {
		cmd := exec.CommandContext(runCtx, executablePath, jsonArgs...)
		out, err := cmd.Output()
		if err != nil {
			continue
		}
		if models, ok := parseOpenclawAgentsJSON(out); ok {
			return models, nil
		}
	}

	// Text fallback. Be strict — the default output is a decorated
	// banner with box-drawing and section headers, and picking up
	// the wrong tokens produces nonsense entries like "Identity:".
	cmd := exec.CommandContext(runCtx, executablePath, "agents", "list")
	out, err := cmd.Output()
	if err != nil {
		return []Model{}, nil
	}
	return parseOpenclawAgents(string(out)), nil
}

// openclawAgentEntry is the shape parseOpenclawAgentsJSON expects
// from `openclaw agents list --json`. Both `name` and `id` are
// accepted as the identifier (different openclaw versions ship
// different field names); `model` is optional and only used to
// enrich the dropdown label.
type openclawAgentEntry struct {
	Name  string `json:"name"`
	ID    string `json:"id"`
	Model string `json:"model"`
}

// parseOpenclawAgentsJSON accepts `openclaw agents list --json`-style
// output. It handles two common shapes: a top-level array, or an
// object with an `agents` key whose value is an array. Returns
// ok=false if the input isn't valid JSON in either shape.
func parseOpenclawAgentsJSON(raw []byte) ([]Model, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil, false
	}

	var flat []openclawAgentEntry
	if err := json.Unmarshal(raw, &flat); err == nil {
		return openclawEntriesToModels(flat), true
	}

	var wrapped struct {
		Agents []openclawAgentEntry `json:"agents"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Agents != nil {
		return openclawEntriesToModels(wrapped.Agents), true
	}

	return nil, false
}

func openclawEntriesToModels(entries []openclawAgentEntry) []Model {
	models := make([]Model, 0, len(entries))
	seen := map[string]bool{}
	for _, e := range entries {
		name := e.Name
		if name == "" {
			name = e.ID
		}
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		label := name
		if e.Model != "" {
			label = name + " (" + e.Model + ")"
		}
		models = append(models, Model{ID: name, Label: label, Provider: "openclaw"})
	}
	return models
}

// parseOpenclawAgents extracts agent names from the text output of
// `openclaw agents list`. The default CLI output is a decorated
// banner — section headers ending in `:`, box-drawing characters,
// and single-character icons — so we only accept lines that look
// like a proper `<name> <model>` row: at least two whitespace-
// separated tokens, both made of safe identifier characters, and
// neither ending in `:`. Anything else is discarded to avoid
// surfacing "Identity:" or `◇` as selectable models.
func parseOpenclawAgents(output string) []Model {
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var models []Model
	seen := map[string]bool{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name, model := fields[0], fields[1]
		if !isOpenclawIdentifier(name) || !isOpenclawIdentifier(model) {
			continue
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		models = append(models, Model{
			ID:       name,
			Label:    name + " (" + model + ")",
			Provider: "openclaw",
		})
	}
	return models
}

// isOpenclawIdentifier reports whether s looks like a valid
// agent-name or model-id token: starts with a letter, contains only
// identifier-safe characters, and isn't a section header
// (trailing colon). Rejects TUI decoration like `│`, `╭`, `◇`, `|`.
func isOpenclawIdentifier(s string) bool {
	if s == "" || strings.HasSuffix(s, ":") {
		return false
	}
	first := s[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z')) {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.' || r == '/':
		default:
			return false
		}
	}
	return true
}
