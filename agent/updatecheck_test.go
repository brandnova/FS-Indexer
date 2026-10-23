package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.0", "0.1.0", 0},
		{"v0.2.0", "0.1.9", 1},
		{"0.1.0", "0.1.0-rc4", 1},
		{"0.1.0-rc5", "0.1.0-rc4", 1},
		{"0.1.0-rc10", "0.1.0-rc9", 1},
		{"0.1.0-rc3", "0.1.0", -1},
		{"1.0.0", "0.9.9", 1},
		{"0.1.0", "dev", 0},
		{"dev", "dev", 0},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

const releasesJSON = `[
  {"tag_name":"v0.2.0-rc1","html_url":"https://github.com/x/y/releases/tag/v0.2.0-rc1","draft":false,"prerelease":true},
  {"tag_name":"v0.1.1","html_url":"https://github.com/x/y/releases/tag/v0.1.1","draft":false,"prerelease":false},
  {"tag_name":"v0.3.0","html_url":"https://github.com/x/y/releases/tag/v0.3.0","draft":true,"prerelease":false},
  {"tag_name":"v0.1.0","html_url":"https://evil.example/x","draft":false,"prerelease":false}
]`

func newTestChecker(t *testing.T, status int, body string) (*UpdateChecker, *Indexer) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "perigee/") {
			t.Errorf("the request should say who is asking: %q", r.Header.Get("User-Agent"))
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	ix := NewIndexer(&Config{CheckForUpdates: true})
	u := NewUpdateChecker(ix)
	u.endpoint = srv.URL
	return u, ix
}

func TestUpdateCheckerPicksTheNewestAllowedRelease(t *testing.T) {
	old := version
	t.Cleanup(func() { version = old })
	u, ix := newTestChecker(t, http.StatusOK, releasesJSON)

	version = "0.1.0" // stable: prereleases and drafts are ignored
	if info := u.Check(context.Background()); info.Latest != "0.1.1" || !info.Newer || info.CheckedAt == 0 {
		t.Errorf("stable user: %+v", info)
	}

	version = "0.1.0-rc3" // a candidate also hears about newer candidates
	if info := u.Check(context.Background()); info.Latest != "0.2.0-rc1" || !info.Newer {
		t.Errorf("candidate user: %+v", info)
	}

	off := ix.Config().clone()
	off.CheckForUpdates = false
	ix.SetConfig(off)
	if u.Status().Newer || u.Available() != "" {
		t.Error("nothing is announced while checking is switched off")
	}
}

func TestUpdateCheckerFailuresAreQuiet(t *testing.T) {
	u, _ := newTestChecker(t, http.StatusInternalServerError, "nope")
	info := u.Check(context.Background())
	if info.Error == "" || info.Latest != "" || info.Newer {
		t.Errorf("a failed check should say so and announce nothing: %+v", info)
	}
}

func TestUpdateLinkMustBeGitHub(t *testing.T) {
	old := version
	t.Cleanup(func() { version = old })
	version = "0.0.9"
	u, _ := newTestChecker(t, http.StatusOK, `[{"tag_name":"v0.1.0","html_url":"https://evil.example/x","draft":false,"prerelease":false}]`)
	if info := u.Check(context.Background()); !strings.HasPrefix(info.URL, "https://github.com/") {
		t.Errorf("the link must stay on GitHub, got %q", info.URL)
	}
}