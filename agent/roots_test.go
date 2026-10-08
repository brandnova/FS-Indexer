package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

func TestRoots(t *testing.T) {
	ts, _ := newTestServer(t)

	if got := request(t, "GET", ts.URL+"/api/v1/roots", "").StatusCode; got != http.StatusUnauthorized {
		t.Errorf("without a token got %d, want 401", got)
	}

	resp := request(t, "GET", ts.URL+"/api/v1/roots", testToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var body struct {
		Sep   string `json:"sep"`
		Roots []struct {
			Label string `json:"label"`
			Path  string `json:"path"`
		} `json:"roots"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	if body.Sep != string(filepath.Separator) {
		t.Errorf("sep = %q, want %q", body.Sep, string(filepath.Separator))
	}
	if len(body.Roots) != 1 || body.Roots[0].Label != "Root" || !filepath.IsAbs(body.Roots[0].Path) {
		t.Errorf("roots = %+v", body.Roots)
	}
}