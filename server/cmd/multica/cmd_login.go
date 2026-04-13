package main

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var nonSlugChar = regexp.MustCompile(`[^a-z0-9-]+`)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate and set up workspaces",
	Long:  "Log in to Multica, then automatically discover and watch all your workspaces.",
	RunE:  runLogin,
}

func init() {
	loginCmd.Flags().Bool("token", false, "Authenticate by pasting a personal access token")
}

func runLogin(cmd *cobra.Command, args []string) error {
	// Run the standard auth login flow.
	if err := runAuthLogin(cmd, args); err != nil {
		return err
	}

	// Auto-discover and watch all workspaces.
	if err := autoWatchWorkspaces(cmd); err != nil {
		fmt.Fprintf(os.Stderr, "\nCould not auto-configure workspaces: %v\n", err)
		fmt.Fprintf(os.Stderr, "Run 'multica workspace list' and 'multica workspace watch <id>' to set up manually.\n")
		return nil
	}

	fmt.Fprintf(os.Stderr, "\n→ Run 'multica daemon start' to start your local agent runtime.\n")
	return nil
}

func autoWatchWorkspaces(cmd *cobra.Command) error {
	serverURL := resolveServerURL(cmd)
	token := resolveToken(cmd)
	if token == "" {
		return fmt.Errorf("not authenticated")
	}

	client := cli.NewAPIClient(serverURL, "", token)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var workspaces []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := client.GetJSON(ctx, "/api/workspaces", &workspaces); err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}

	if len(workspaces) == 0 {
		fmt.Fprintln(os.Stderr, "\nNo workspaces found. Creating one for you...")
		ws, err := createDefaultWorkspace(ctx, client)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Could not create workspace: %v\n", err)
			fmt.Fprintln(os.Stderr, "Create one at the web dashboard, then run 'multica login' again.")
			return nil
		}
		workspaces = append(workspaces, ws)
	}

	profile := resolveProfile(cmd)
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil {
		return err
	}

	var added int
	for _, ws := range workspaces {
		if cfg.AddWatchedWorkspace(ws.ID, ws.Name) {
			added++
		}
	}

	// Set default workspace if not set.
	if cfg.WorkspaceID == "" {
		cfg.WorkspaceID = workspaces[0].ID
	}

	if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
		return err
	}

	if added > 0 {
		fmt.Fprintf(os.Stderr, "\nWatching %d workspace(s):\n", len(workspaces))
		for _, ws := range workspaces {
			fmt.Fprintf(os.Stderr, "  • %s (%s)\n", ws.Name, ws.ID)
		}
	} else {
		fmt.Fprintf(os.Stderr, "\nAll %d workspace(s) already watched.\n", len(workspaces))
	}

	return nil
}

// nameToSlug converts a human name into a URL-safe slug.
// E.g. "Alice Zhang" → "alice-zhang".
func nameToSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonSlugChar.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	// Collapse consecutive hyphens.
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	if s == "" {
		s = "my-workspace"
	}
	return s
}

// createDefaultWorkspace creates a workspace for a new user who has none.
func createDefaultWorkspace(ctx context.Context, client *cli.APIClient) (struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}, error) {
	type wsInfo struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	var zero wsInfo

	// Fetch the current user's name to derive workspace name/slug.
	var me struct {
		Name string `json:"name"`
	}
	if err := client.GetJSON(ctx, "/api/me", &me); err != nil {
		return zero, fmt.Errorf("fetch user info: %w", err)
	}

	wsName := strings.TrimSpace(me.Name) + "'s Workspace"
	slug := nameToSlug(me.Name)

	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	err := client.PostJSON(ctx, "/api/workspaces", map[string]string{
		"name": wsName,
		"slug": slug,
	}, &created)
	if err != nil {
		return zero, fmt.Errorf("create workspace: %w", err)
	}

	fmt.Fprintf(os.Stderr, "✓ Created workspace %q (%s)\n", created.Name, created.ID)
	return created, nil
}
