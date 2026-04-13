package middleware

import "net/http"

func ContentSecurityPolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' wss:; frame-ancestors 'none'; object-src 'none'")
		next.ServeHTTP(w, r)
	})
}
