package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const downloadBody = "hello world, this is a test" // 27 bytes

type downloadFixture struct {
	ts      *httptest.Server
	ix      *Indexer
	cfg     *Config
	root    string
	outside string
}

func newDownloadFixture(t *testing.T, allow bool) *downloadFixture {
	t.Helper()
	root := resolvedPath(t.TempDir())
	outside := resolvedPath(t.TempDir())

	write := func(rel, content string) {
		t.Helper()
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a.txt", downloadBody)
	write("sub/b.bin", "binary-ish")
	write("my file (1).txt", "spaces and brackets")
	write(".env", "SECRET=1")
	write(".hidden/x.txt", "hidden")
	write("note.tmp", "temporary")
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A link that leads out of the folder. (Creating links can fail on Windows: that case is then skipped.)
	_ = os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "link.txt"))

	cfg := &Config{
		DeviceID: "0123456789abcdef", DeviceName: "test-pc", Port: 8080, Token: testToken,
		Roots:           []Root{{Path: root, Label: "Root"}},
		ExtraIgnores:    []string{"*.tmp"},
		AllowFileAccess: allow,
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	ts := httptest.NewServer(NewServer(cfg, ix).Handler)
	t.Cleanup(ts.Close)
	return &downloadFixture{ts: ts, ix: ix, cfg: cfg, root: root, outside: outside}
}

func (f *downloadFixture) get(t *testing.T, method, path string, headers map[string]string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, f.ts.URL+"/api/v1/download?path="+url.QueryEscape(path), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(data)
}

func TestDownloadIsOffByDefault(t *testing.T) {
	f := newDownloadFixture(t, false)
	resp, body := f.get(t, "GET", "Root/a.txt", nil)
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "downloads_off") {
		t.Errorf("got %d %s, want 403 downloads_off", resp.StatusCode, body)
	}
}

func TestDownloadSendsTheFile(t *testing.T) {
	f := newDownloadFixture(t, true)

	resp, body := f.get(t, "GET", "Root/a.txt", nil)
	if resp.StatusCode != http.StatusOK || body != downloadBody {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "attachment") || resp.Header.Get("X-Content-Type-Options") != "nosniff" || resp.Header.Get("Content-Type") == "" {
		t.Errorf("unexpected headers: %v", resp.Header)
	}

	resp, body = f.get(t, "GET", "Root/my file (1).txt", nil)
	if resp.StatusCode != http.StatusOK || body != "spaces and brackets" {
		t.Errorf("a name with spaces got %d %q", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "filename*=UTF-8''my%20file%20%281%29.txt") {
		t.Errorf("the file name isn't escaped: %s", resp.Header.Get("Content-Disposition"))
	}

	if resp, body := f.get(t, "GET", "Root/sub/b.bin", nil); resp.StatusCode != http.StatusOK || body != "binary-ish" {
		t.Errorf("a file in a sub folder got %d %q", resp.StatusCode, body)
	}
	if resp, _ := f.get(t, "HEAD", "Root/a.txt", nil); resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Length") != "27" {
		t.Errorf("HEAD got %d, length %q", resp.StatusCode, resp.Header.Get("Content-Length"))
	}
}

func TestDownloadSupportsRanges(t *testing.T) {
	f := newDownloadFixture(t, true)

	resp, body := f.get(t, "GET", "Root/a.txt", map[string]string{"Range": "bytes=6-10"})
	if resp.StatusCode != http.StatusPartialContent || body != "world" {
		t.Fatalf("got %d %q, want 206 world", resp.StatusCode, body)
	}
	if want := fmt.Sprintf("bytes 6-10/%d", len(downloadBody)); resp.Header.Get("Content-Range") != want {
		t.Errorf("Content-Range = %q, want %q", resp.Header.Get("Content-Range"), want)
	}
	if resp.Header.Get("Accept-Ranges") != "bytes" {
		t.Error("the file should advertise that ranges work")
	}
	if _, body := f.get(t, "GET", "Root/a.txt", map[string]string{"Range": "bytes=23-"}); body != "test" {
		t.Errorf("an open-ended range gave %q", body)
	}
}

func TestDownloadRefusesEverythingElse(t *testing.T) {
	f := newDownloadFixture(t, true)

	paths := []string{
		"", "Root", "Root/", "Root/sub",
		"Root/../etc/passwd", "../Root/a.txt", "/etc/passwd", "Root/sub/../a.txt", "Root//a.txt", "Root/./a.txt", "Root/a.txt/",
		"root/A.TXT",
		"Root/.env", "Root/.hidden/x.txt", "Root/note.tmp",
		"Root/a.txt\x00.png", `Root\a.txt`, "Other/a.txt", "Root/missing.txt", "Root/link.txt",
		filepath.Join(f.root, "a.txt"),
		filepath.Join(f.outside, "secret.txt"),
	}
	for _, p := range paths {
		resp, body := f.get(t, "GET", p, nil)
		if resp.StatusCode != http.StatusNotFound || !strings.Contains(body, "not_found") {
			t.Errorf("path %q got %d %q, want 404", p, resp.StatusCode, body)
		}
		if strings.Contains(body, "SECRET") || strings.Contains(body, "outside") {
			t.Errorf("path %q leaked something: %q", p, body)
		}
	}
}

func TestDownloadChecksTheCurrentRules(t *testing.T) {
	f := newDownloadFixture(t, true)

	rules := f.cfg.clone()
	rules.ExtraIgnores = append(rules.ExtraIgnores, "a.txt")
	f.ix.SetConfig(rules) // a rule added after the scan must apply straight away
	if resp, _ := f.get(t, "GET", "Root/a.txt", nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("a file skipped by a new rule got %d, want 404", resp.StatusCode)
	}

	off := f.cfg.clone()
	off.Roots[0].Disabled = true
	f.ix.SetConfig(off)
	if resp, _ := f.get(t, "GET", "Root/sub/b.bin", nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("a file in a folder that was switched off got %d, want 404", resp.StatusCode)
	}
}

func TestDownloadStopsASwappedFolder(t *testing.T) {
	f := newDownloadFixture(t, true)
	if err := os.MkdirAll(filepath.Join(f.root, "swap"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "swap", "f.txt"), []byte("inside"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.ix.StartScan()
	waitForScan(t, f.ix)
	if resp, body := f.get(t, "GET", "Root/swap/f.txt", nil); resp.StatusCode != http.StatusOK || body != "inside" {
		t.Fatalf("before the swap got %d %q", resp.StatusCode, body)
	}

	// After the scan, the folder is replaced by a link to somewhere outside.
	if err := os.WriteFile(filepath.Join(f.outside, "f.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(f.root, "swap")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(f.outside, filepath.Join(f.root, "swap")); err != nil {
		t.Skip("this system can't create links")
	}
	if resp, body := f.get(t, "GET", "Root/swap/f.txt", nil); resp.StatusCode != http.StatusNotFound || strings.Contains(body, "outside") {
		t.Errorf("a folder swapped for a link got %d %q, want 404", resp.StatusCode, body)
	}
}

func TestDownloadHasALimit(t *testing.T) {
	f := newDownloadFixture(t, true)

	old := downloadSlots
	downloadSlots = make(chan struct{}, 1)
	downloadSlots <- struct{}{}
	t.Cleanup(func() { downloadSlots = old })

	resp, _ := f.get(t, "GET", "Root/a.txt", nil)
	if resp.StatusCode != http.StatusServiceUnavailable || resp.Header.Get("Retry-After") == "" {
		t.Errorf("a full server got %d, want 503 with Retry-After", resp.StatusCode)
	}
}

func TestDownloadNeedsAKey(t *testing.T) {
	f := newDownloadFixture(t, true)
	resp, err := http.Get(f.ts.URL + "/api/v1/download?path=Root/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a key got %d, want 401", resp.StatusCode)
	}
}

func TestPingSaysWhetherFilesCanBeOpened(t *testing.T) {
	for _, allow := range []bool{false, true} {
		f := newDownloadFixture(t, allow)
		req, _ := http.NewRequest("GET", f.ts.URL+"/api/v1/ping", nil)
		req.Header.Set("Authorization", "Bearer "+testToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if want := fmt.Sprintf(`"file_access":%v`, allow); !strings.Contains(string(data), want) {
			t.Errorf("ping = %s, want it to contain %s", data, want)
		}
	}
}

func TestContentDisposition(t *testing.T) {
	got := contentDisposition(`é "x".txt`)
	if !strings.Contains(got, `filename="_ _x_.txt"`) || !strings.Contains(got, "filename*=UTF-8''%C3%A9%20%22x%22.txt") {
		t.Errorf("contentDisposition = %s", got)
	}
}

func TestDoctorFileAccessCheck(t *testing.T) {
	off := &doctorEnv{DoctorInput: DoctorInput{Config: &Config{}}}
	on := &doctorEnv{DoctorInput: DoctorInput{Config: &Config{AllowFileAccess: true}}}
	if res, _ := checkFileAccess(off); !strings.Contains(res.Detail, "Off") {
		t.Errorf("unexpected: %+v", res)
	}
	if res, _ := checkFileAccess(on); !strings.Contains(res.Detail, "On") {
		t.Errorf("unexpected: %+v", res)
	}
}