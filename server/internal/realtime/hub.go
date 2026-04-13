package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/auth"
)

// MembershipChecker verifies a user belongs to a workspace.
type MembershipChecker interface {
	IsMember(ctx context.Context, userID, workspaceID string) bool
}

// PATResolver resolves a Personal Access Token to a user ID.
// Returns the user ID and true if the token is valid, or ("", false) otherwise.
type PATResolver interface {
	ResolveToken(ctx context.Context, token string) (userID string, ok bool)
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// TODO: Restrict origins in production
		return true
	},
}

// Client represents a single WebSocket connection with identity.
type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	userID      string
	workspaceID string
}

// Hub manages WebSocket connections organized by workspace rooms.
type Hub struct {
	rooms      map[string]map[*Client]bool // workspaceID -> clients
	broadcast  chan []byte                  // global broadcast (daemon events)
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub event loop.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			room := client.workspaceID
			if h.rooms[room] == nil {
				h.rooms[room] = make(map[*Client]bool)
			}
			h.rooms[room][client] = true
			total := 0
			for _, r := range h.rooms {
				total += len(r)
			}
			h.mu.Unlock()
			slog.Info("ws client connected", "workspace_id", room, "total_clients", total)

		case client := <-h.unregister:
			h.mu.Lock()
			room := client.workspaceID
			if clients, ok := h.rooms[room]; ok {
				if _, exists := clients[client]; exists {
					delete(clients, client)
					close(client.send)
					if len(clients) == 0 {
						delete(h.rooms, room)
					}
				}
			}
			total := 0
			for _, r := range h.rooms {
				total += len(r)
			}
			h.mu.Unlock()
			slog.Info("ws client disconnected", "workspace_id", room, "total_clients", total)

		case message := <-h.broadcast:
			// Global broadcast for daemon events (no workspace filtering)
			h.mu.RLock()
			var slow []*Client
			for _, clients := range h.rooms {
				for client := range clients {
					select {
					case client.send <- message:
					default:
						slow = append(slow, client)
					}
				}
			}
			h.mu.RUnlock()
			if len(slow) > 0 {
				h.mu.Lock()
				for _, client := range slow {
					room := client.workspaceID
					if clients, ok := h.rooms[room]; ok {
						if _, exists := clients[client]; exists {
							delete(clients, client)
							close(client.send)
							if len(clients) == 0 {
								delete(h.rooms, room)
							}
						}
					}
				}
				h.mu.Unlock()
			}
		}
	}
}

// BroadcastToWorkspace sends a message only to clients in the given workspace.
func (h *Hub) BroadcastToWorkspace(workspaceID string, message []byte) {
	h.mu.RLock()
	clients := h.rooms[workspaceID]
	var slow []*Client
	for client := range clients {
		select {
		case client.send <- message:
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()

	// Remove slow clients under write lock
	if len(slow) > 0 {
		h.mu.Lock()
		for _, client := range slow {
			if room, ok := h.rooms[workspaceID]; ok {
				if _, exists := room[client]; exists {
					delete(room, client)
					close(client.send)
					if len(room) == 0 {
						delete(h.rooms, workspaceID)
					}
				}
			}
		}
		h.mu.Unlock()
	}
}

// SendToUser sends a message to all connections belonging to a specific user,
// regardless of which workspace room they are in. Connections in excludeWorkspace
// are skipped (they already receive the message via BroadcastToWorkspace).
func (h *Hub) SendToUser(userID string, message []byte, excludeWorkspace ...string) {
	exclude := ""
	if len(excludeWorkspace) > 0 {
		exclude = excludeWorkspace[0]
	}

	h.mu.RLock()
	type target struct {
		client      *Client
		workspaceID string
	}
	var targets []target
	for wsID, clients := range h.rooms {
		if wsID == exclude {
			continue
		}
		for client := range clients {
			if client.userID == userID {
				targets = append(targets, target{client, wsID})
			}
		}
	}
	h.mu.RUnlock()

	var slow []target
	for _, t := range targets {
		select {
		case t.client.send <- message:
		default:
			slow = append(slow, t)
		}
	}

	// Remove slow clients under write lock (same pattern as BroadcastToWorkspace)
	if len(slow) > 0 {
		h.mu.Lock()
		for _, t := range slow {
			if room, ok := h.rooms[t.workspaceID]; ok {
				if _, exists := room[t.client]; exists {
					delete(room, t.client)
					close(t.client.send)
					if len(room) == 0 {
						delete(h.rooms, t.workspaceID)
					}
				}
			}
		}
		h.mu.Unlock()
	}
}

// Broadcast sends a message to all connected clients (used for daemon events).
func (h *Hub) Broadcast(message []byte) {
	h.broadcast <- message
}

const authTimeout = 5 * time.Second

type authMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// HandleWebSocket upgrades an HTTP connection to WebSocket.
// Authentication is performed via the first message after connection establishment,
// keeping the token out of URL query parameters (and thus out of server logs,
// proxy logs, and browser history).
func HandleWebSocket(hub *Hub, mc MembershipChecker, pr PATResolver, w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		http.Error(w, `{"error":"workspace_id required"}`, http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	sendErr := func(msg string) {
		errResp, _ := json.Marshal(map[string]string{"type": "auth_error", "error": msg})
		conn.WriteMessage(websocket.TextMessage, errResp)
		conn.Close()
	}

	conn.SetReadDeadline(time.Now().Add(authTimeout))

	_, raw, err := conn.ReadMessage()
	if err != nil {
		slog.Debug("ws auth read failed", "error", err)
		conn.Close()
		return
	}

	var msg authMessage
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Type != "auth" || msg.Token == "" {
		sendErr("invalid auth message")
		return
	}

	tokenStr := msg.Token
	var userID string

	if strings.HasPrefix(tokenStr, "mul_") {
		if pr == nil {
			sendErr("invalid token")
			return
		}
		uid, ok := pr.ResolveToken(r.Context(), tokenStr)
		if !ok {
			sendErr("invalid token")
			return
		}
		userID = uid
	} else {
		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return auth.JWTSecret(), nil
		})
		if err != nil || !token.Valid {
			sendErr("invalid token")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			sendErr("invalid claims")
			return
		}

		uid, ok := claims["sub"].(string)
		if !ok || strings.TrimSpace(uid) == "" {
			sendErr("invalid claims")
			return
		}
		userID = uid
	}

	if !mc.IsMember(r.Context(), userID, workspaceID) {
		sendErr("not a member of this workspace")
		return
	}

	conn.SetReadDeadline(time.Time{})
	conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth_ok"}`))

	client := &Client{
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		userID:      userID,
		workspaceID: workspaceID,
	}
	hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Debug("websocket read error", "error", err, "user_id", c.userID, "workspace_id", c.workspaceID)
			}
			break
		}
		// TODO: Route inbound messages to appropriate handlers
		slog.Debug("ws message received", "user_id", c.userID, "workspace_id", c.workspaceID)
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			slog.Warn("websocket write error", "error", err)
			return
		}
	}
}
