package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const updateInterval = 24 * time.Hour

// updates is the agent's update checker. It stays nil until main creates it; every method is safe on nil.
var updates *UpdateChecker

// UpdateInfo is what the dashboard shows.
type UpdateInfo struct {
	Enabled   bool   `json:"enabled"`
	Latest    string `json:"latest"`     // for example "0.1.1" ("" until a check has worked)
	URL       string `json:"url"`        // its release page
	Newer     bool   `json:"newer"`      // Latest is newer than this version
	CheckedAt int64  `json:"checked_at"` // unix seconds; 0 means never
	Error     string `json:"error,omitempty"`
}

// UpdateChecker asks GitHub, at most once a day and only when the person has switched it on,
// what the newest release is. Nothing about the person or the computer is sent.
type UpdateChecker struct {
	ix       *Indexer
	endpoint string
	client   *http.Client

	mu         sync.Mutex
	latest     string
	url        string
	checkedAt  time.Time
	lastErr    string
	lastManual time.Time
}

func NewUpdateChecker(ix *Indexer) *UpdateChecker {
	return &UpdateChecker{
		ix:       ix,
		endpoint: "https://api.github.com/repos/" + githubRepo + "/releases?per_page=10",
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Run checks shortly after start-up and then daily, while "check for updates" is on.
func (u *UpdateChecker) Run(ctx context.Context) {
	if u == nil {
		return
	}
	timer := time.NewTimer(30 * time.Second) // not right at start-up
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if u.ix.Config().CheckForUpdates {
			u.Check(ctx)
		}
		timer.Reset(updateInterval)
	}
}

// Status is the last known answer. It reports nothing as "newer" while checking is switched off.
func (u *UpdateChecker) Status() UpdateInfo {
	if u == nil {
		return UpdateInfo{}
	}
	enabled := u.ix.Config().CheckForUpdates
	u.mu.Lock()
	defer u.mu.Unlock()
	info := UpdateInfo{Enabled: enabled, Latest: u.latest, URL: u.url, Error: u.lastErr}
	if !u.checkedAt.IsZero() {
		info.CheckedAt = u.checkedAt.Unix()
	}
	info.Newer = enabled && u.latest != "" && compareVersions(u.latest, version) > 0
	return info
}

// Available is the newest version if it is newer than this one, otherwise "".
func (u *UpdateChecker) Available() string {
	if info := u.Status(); info.Newer {
		return info.Latest
	}
	return ""
}

// Check asks GitHub now.
func (u *UpdateChecker) Check(ctx context.Context) UpdateInfo {
	if u == nil {
		return UpdateInfo{}
	}
	latest, link, err := u.fetch(ctx)

	u.mu.Lock()
	u.checkedAt = time.Now()
	if err != nil {
		u.lastErr = "Couldn't reach GitHub just now."
		u.mu.Unlock()
		logs.Warnf("update", "the update check failed: %v", err)
		return u.Status()
	}
	changed := latest != u.latest
	u.lastErr, u.latest, u.url = "", latest, link
	u.mu.Unlock()

	if changed {
		logs.Infof("update", "the newest version on GitHub is %s (this is %s)", latest, versionLabel())
	}
	return u.Status()
}

// CheckManually is the "Check now" button: at most once every 15 seconds.
func (u *UpdateChecker) CheckManually(ctx context.Context) (UpdateInfo, error) {
	if u == nil {
		return UpdateInfo{}, nil
	}
	u.mu.Lock()
	if time.Since(u.lastManual) < 15*time.Second {
		u.mu.Unlock()
		return u.Status(), errors.New("Wait a few seconds before checking again.")
	}
	u.lastManual = time.Now()
	u.mu.Unlock()
	return u.Check(ctx), nil
}

func (u *UpdateChecker) fetch(ctx context.Context) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.endpoint, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "perigee/"+strings.TrimPrefix(version, "v"))

	resp, err := u.client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("GitHub answered %d", resp.StatusCode)
	}

	var list []struct {
		TagName    string `json:"tag_name"`
		HTMLURL    string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&list); err != nil {
		return "", "", err
	}

	_, currentPre, _ := parseVersion(version)
	best, bestURL := "", ""
	for _, r := range list {
		tag := strings.TrimPrefix(r.TagName, "v")
		if r.Draft {
			continue
		}
		if _, _, ok := parseVersion(tag); !ok {
			continue
		}
		if (r.Prerelease || strings.Contains(tag, "-")) && currentPre == "" {
			continue // someone on a stable version only hears about stable releases
		}
		if best == "" || compareVersions(tag, best) > 0 {
			best, bestURL = tag, r.HTMLURL
		}
	}
	if best == "" {
		return "", "", errors.New("no releases found")
	}
	if !strings.HasPrefix(bestURL, "https://github.com/") {
		bestURL = "https://github.com/" + githubRepo + "/releases"
	}
	return best, bestURL, nil
}

// ---------- version comparison ----------

func parseVersion(s string) (nums [3]int, pre string, ok bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, '-'); i >= 0 {
		pre, s = s[i+1:], s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return nums, "", false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nums, "", false
		}
		nums[i] = n
	}
	return nums, pre, true
}

// compareVersions returns -1, 0 or 1. A release is newer than its own release candidates, and
// "rc10" is newer than "rc9". Anything that isn't a version (a development build) compares as equal.
func compareVersions(a, b string) int {
	na, pa, okA := parseVersion(a)
	nb, pb, okB := parseVersion(b)
	if !okA || !okB {
		return 0
	}
	for i := 0; i < 3; i++ {
		if na[i] != nb[i] {
			if na[i] < nb[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case pa == pb:
		return 0
	case pa == "":
		return 1
	case pb == "":
		return -1
	}
	xs, ys := strings.Split(pa, "."), strings.Split(pb, ".")
	for i := 0; i < len(xs) && i < len(ys); i++ {
		if c := compareIdentifier(xs[i], ys[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(xs) < len(ys):
		return -1
	case len(xs) > len(ys):
		return 1
	}
	return 0
}

// splitTrailingNumber turns "rc10" into ("rc", 10, true).
func splitTrailingNumber(s string) (string, int, bool) {
	i := len(s)
	for i > 0 && unicode.IsDigit(rune(s[i-1])) {
		i--
	}
	if i == len(s) {
		return s, 0, false
	}
	n, err := strconv.Atoi(s[i:])
	if err != nil {
		return s, 0, false
	}
	return s[:i], n, true
}

func compareIdentifier(x, y string) int {
	px, nx, hasX := splitTrailingNumber(x)
	py, ny, hasY := splitTrailingNumber(y)
	if px == py && hasX && hasY {
		switch {
		case nx < ny:
			return -1
		case nx > ny:
			return 1
		}
		return 0
	}
	return strings.Compare(x, y)
}