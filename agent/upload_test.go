package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type uploadFixture struct {
	ts    *httptest.Server
	ix    *Indexer
	cfg   *Config
	dir   string
	token string // the key of a paired phone
}

func newUploadFixture(t *testing.T, mutate func(*Config)) *uploadFixture {
	t.Helper()
	dir := resolvedPath(t.TempDir())
	cfg := &Config{
		DeviceID: "0123456789abcdef", DeviceName: "test-pc", Port: 8080, Token: testToken,
		Roots:        []Root{{Path: resolvedPath(t.TempDir()), Label: "Root"}},
		AllowUploads: true, UploadDir: dir,
	}
	if mutate != nil {
		mutate(cfg)
	}
	ix := NewIndexer(cfg)
	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := devices.Add("Pixel 8")
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(NewServerWith(cfg, ix, ServerDeps{Devices: devices, Codes: NewPairingCodes(time.Minute)}).Handler)
	t.Cleanup(ts.Close)

	old := uploads
	uploads = &uploadCounter{}
	t.Cleanup(func() { uploads = old })
	return &uploadFixture{ts: ts, ix: ix, cfg: cfg, dir: dir, token: token}
}

func (f *uploadFixture) post(t *testing.T, bearer, name string, body io.Reader) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest("POST", f.ts.URL+"/api/v1/upload", body)
	if err != nil {
		t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if name != "" {
		req.Header.Set("X-File-Name", url.PathEscape(name)) // what encodeURIComponent does in the app
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(data)
}

func (f *uploadFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestUploadIsOffByDefault(t *testing.T) {
	f := newUploadFixture(t, func(c *Config) { c.AllowUploads = false })
	if resp, body := f.post(t, f.token, "a.txt", strings.NewReader("x")); resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "uploads_off") {
		t.Errorf("got %d %s, want 403 uploads_off", resp.StatusCode, body)
	}
	f = newUploadFixture(t, func(c *Config) { c.UploadDir = "" })
	if resp, _ := f.post(t, f.token, "a.txt", strings.NewReader("x")); resp.StatusCode != http.StatusForbidden {
		t.Errorf("switched on without a folder got %d, want 403", resp.StatusCode)
	}
}

func TestUploadNeedsAPairedPhone(t *testing.T) {
	f := newUploadFixture(t, nil)
	if resp, body := f.post(t, testToken, "a.txt", strings.NewReader("x")); resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "pair_again") {
		t.Errorf("the shared token got %d %s, want 403 pair_again", resp.StatusCode, body)
	}
	if resp, _ := f.post(t, "", "a.txt", strings.NewReader("x")); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no key got %d, want 401", resp.StatusCode)
	}
	if got := f.files(t); len(got) != 0 {
		t.Errorf("nothing should have been saved, got %v", got)
	}
}

func TestUploadSavesAFileAndNeverOverwrites(t *testing.T) {
	f := newUploadFixture(t, nil)

	resp, body := f.post(t, f.token, "notes.txt", strings.NewReader("first"))
	if resp.StatusCode != http.StatusCreated || !strings.Contains(body, `"name":"notes.txt"`) {
		t.Fatalf("got %d %s", resp.StatusCode, body)
	}
	resp, body = f.post(t, f.token, "notes.txt", strings.NewReader("second"))
	if resp.StatusCode != http.StatusCreated || !strings.Contains(body, `"name":"notes (1).txt"`) {
		t.Fatalf("a second file with the same name got %d %s", resp.StatusCode, body)
	}

	if data, _ := os.ReadFile(filepath.Join(f.dir, "notes.txt")); string(data) != "first" {
		t.Errorf("the first file was changed: %q", data)
	}
	if data, _ := os.ReadFile(filepath.Join(f.dir, "notes (1).txt")); string(data) != "second" {
		t.Errorf("the second file is wrong: %q", data)
	}
	if got := f.files(t); len(got) != 2 {
		t.Errorf("expected exactly two files and no leftovers, got %v", got)
	}
}

func TestUploadKeepsEverythingInTheDropFolder(t *testing.T) {
	f := newUploadFixture(t, nil)

	resp, body := f.post(t, f.token, "../../evil.txt", strings.NewReader("x"))
	if resp.StatusCode != http.StatusCreated || !strings.Contains(body, `"name":"evil.txt"`) {
		t.Fatalf("got %d %s", resp.StatusCode, body)
	}
	if _, err := os.Stat(filepath.Join(f.dir, "evil.txt")); err != nil {
		t.Errorf("the file should be in the drop folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(filepath.Dir(f.dir)), "evil.txt")); err == nil {
		t.Error("a file escaped the drop folder")
	}
}

func TestUploadLimits(t *testing.T) {
	f := newUploadFixture(t, func(c *Config) { c.UploadMaxMB = 1; c.UploadPerHour = 100 })

	big := strings.Repeat("x", 1<<20+10)
	if resp, body := f.post(t, f.token, "big.bin", strings.NewReader(big)); resp.StatusCode != http.StatusRequestEntityTooLarge || !strings.Contains(body, "too_large") {
		t.Errorf("a file over the limit got %d %s, want 413", resp.StatusCode, body)
	}
	// A body of unknown length is cut off at the limit as well.
	if resp, _ := f.post(t, f.token, "big2.bin", io.MultiReader(strings.NewReader(big))); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("a streamed file over the limit got %d, want 413", resp.StatusCode)
	}
	if got := f.files(t); len(got) != 0 {
		t.Errorf("a refused file must leave nothing behind, got %v", got)
	}
	if resp, _ := f.post(t, f.token, "ok.bin", strings.NewReader(strings.Repeat("x", 1<<20))); resp.StatusCode != http.StatusCreated {
		t.Errorf("a file exactly at the limit got %d, want 201", resp.StatusCode)
	}
}

func TestUploadHourlyLimit(t *testing.T) {
	f := newUploadFixture(t, func(c *Config) { c.UploadPerHour = 2 })

	for _, name := range []string{"one.txt", "two.txt"} {
		if resp, _ := f.post(t, f.token, name, strings.NewReader("x")); resp.StatusCode != http.StatusCreated {
			t.Fatalf("%s got %d, want 201", name, resp.StatusCode)
		}
	}
	resp, body := f.post(t, f.token, "three.txt", strings.NewReader("x"))
	if resp.StatusCode != http.StatusTooManyRequests || !strings.Contains(body, "upload_limit") || resp.Header.Get("Retry-After") == "" {
		t.Errorf("the third file got %d %s, want 429 with Retry-After", resp.StatusCode, body)
	}
	if got := f.files(t); len(got) != 2 {
		t.Errorf("only two files should exist, got %v", got)
	}
}

func TestUploadRefusesProgramsUnlessAllowed(t *testing.T) {
	f := newUploadFixture(t, nil)
	if resp, body := f.post(t, f.token, "setup.EXE", strings.NewReader("MZ")); resp.StatusCode != http.StatusUnsupportedMediaType || !strings.Contains(body, "program_file") {
		t.Errorf("a program file got %d %s, want 415", resp.StatusCode, body)
	}
	if resp, _ := f.post(t, f.token, "readme.txt.exe.txt", strings.NewReader("fine")); resp.StatusCode != http.StatusCreated {
		t.Errorf("only the last extension counts, got %d", resp.StatusCode)
	}

	allowed := newUploadFixture(t, func(c *Config) { c.UploadAllowPrograms = true })
	if resp, _ := allowed.post(t, allowed.token, "setup.exe", strings.NewReader("MZ")); resp.StatusCode != http.StatusCreated {
		t.Errorf("with programs allowed got %d, want 201", resp.StatusCode)
	}
}

func TestUploadWithoutADropFolder(t *testing.T) {
	f := newUploadFixture(t, nil)
	if err := os.RemoveAll(f.dir); err != nil {
		t.Fatal(err)
	}
	if resp, body := f.post(t, f.token, "a.txt", strings.NewReader("x")); resp.StatusCode != http.StatusServiceUnavailable || !strings.Contains(body, "drop_folder_unavailable") {
		t.Errorf("a missing drop folder got %d %s, want 503", resp.StatusCode, body)
	}
}

func TestUploadHasALimitOnParallelTransfers(t *testing.T) {
	f := newUploadFixture(t, nil)

	old := uploadSlots
	uploadSlots = make(chan struct{}, 1)
	uploadSlots <- struct{}{}
	t.Cleanup(func() { uploadSlots = old })

	resp, _ := f.post(t, f.token, "a.txt", strings.NewReader("x"))
	if resp.StatusCode != http.StatusServiceUnavailable || resp.Header.Get("Retry-After") == "" {
		t.Errorf("a full server got %d, want 503 with Retry-After", resp.StatusCode)
	}
}

func TestPingTellsAboutUploads(t *testing.T) {
	f := newUploadFixture(t, nil)
	req, _ := http.NewRequest("GET", f.ts.URL+"/api/v1/ping", nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(data), `"uploads":true`) || !strings.Contains(string(data), `"upload_max_mb":100`) {
		t.Errorf("ping = %s", data)
	}
}

func TestSanitizeUploadName(t *testing.T) {
	long := strings.Repeat("a", 300) + ".pdf"
	cases := []struct{ in, want string }{
		{"notes.txt", "notes.txt"},
		{"../../evil.txt", "evil.txt"},
		{`a\b\c.txt`, "c.txt"},
		{"caf%C3%A9.txt", "café.txt"},
		{"100%.txt", "100%.txt"},
		{"a%00b.txt", "ab.txt"},
		{"a:b*c?.txt", "a_b_c_.txt"},
		{".bashrc", "_bashrc"},
		{"..hidden", "__hidden"},
		{"name.   ", "name"},
		{"con.txt", "_con.txt"},
		{"CON", "_CON"},
		{"console.txt", "console.txt"},
		{"", "upload"},
		{"   ", "upload"},
		{"...", "upload"},
	}
	for _, c := range cases {
		if got := sanitizeUploadName(c.in); got != c.want {
			t.Errorf("sanitizeUploadName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if got := sanitizeUploadName(long); len(got) > maxNameBytes || !strings.HasSuffix(got, ".pdf") {
		t.Errorf("a long name should be shortened but keep its extension, got %d bytes %q", len(got), got[len(got)-10:])
	}
}

func TestUploadCounterExpiresOldEntries(t *testing.T) {
	u := &uploadCounter{}
	start := time.Now()
	for i := 0; i < 3; i++ {
		if ok, _ := u.Take(3, start); !ok {
			t.Fatal("the first three should be allowed")
		}
	}
	if ok, wait := u.Take(3, start.Add(time.Minute)); ok || wait <= 0 || wait > time.Hour {
		t.Errorf("the fourth should wait, got %v %v", ok, wait)
	}
	if ok, _ := u.Take(3, start.Add(time.Hour+time.Second)); !ok {
		t.Error("after an hour the limit should have freed up")
	}
	if n := u.Count(start.Add(time.Hour + 2*time.Second)); n != 1 {
		t.Errorf("only the new one should count, got %d", n)
	}
}