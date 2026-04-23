package main

import "testing"

func TestServerHostIsLocal(t *testing.T) {
	cases := []struct {
		name   string
		server string
		want   bool
	}{
		{"localhost", "http://localhost:8080", true},
		{"127.0.0.1", "http://127.0.0.1:8080", true},
		{"IPv6 loopback", "http://[::1]:8080", true},
		{"LAN IP", "http://192.168.0.28:8080", false},
		{"public FQDN", "https://api.internal.co", false},
		{"unparseable", "://bad", false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := serverHostIsLocal(tc.server); got != tc.want {
				t.Errorf("serverHostIsLocal(%q) = %v, want %v", tc.server, got, tc.want)
			}
		})
	}
}

func TestDeriveAppURLFromServerURL(t *testing.T) {
	cases := []struct {
		name   string
		server string
		port   int
		want   string
	}{
		{"LAN IP keeps host, swaps port", "http://192.168.0.28:8080", 3000, "http://192.168.0.28:3000"},
		{"FQDN keeps host, swaps port", "https://api.internal.co", 3000, "http://api.internal.co:3000"},
		{"unparseable falls back to localhost", "://bad", 3000, "http://localhost:3000"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := deriveAppURLFromServerURL(tc.server, tc.port); got != tc.want {
				t.Errorf("deriveAppURLFromServerURL(%q, %d) = %q, want %q", tc.server, tc.port, got, tc.want)
			}
		})
	}
}
