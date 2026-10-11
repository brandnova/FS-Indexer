package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// backgroundMode is true in the detached background process. Problems are then
// shown in the browser, because nobody is watching a terminal.
var backgroundMode bool

// siblingPath puts a helper file next to the settings file: runtime.json and agent.log for the
// default config.json, or <n>.runtime.json / <n>.log for a custom settings file.
func siblingPath(configPath, plain, suffix string) string {
	dir, base := filepath.Split(configPath)
	if base == "config.json" {
		return filepath.Join(dir, plain)
	}
	return filepath.Join(dir, strings.TrimSuffix(base, ".json")+suffix)
}

// ---------- finding a running agent ----------

// runtimeInfo is written while the dashboard is up, so a second launch of the
// agent can find the first and ask it for a fresh dashboard link. The file is
// readable only by the person who runs the agent.
type runtimeInfo struct {
	Port   int    `json:"port"`
	Secret string `json:"secret"`
}

func writeRuntime(path string, info runtimeInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func readRuntime(path string) (runtimeInfo, error) {
	var info runtimeInfo
	data, err := os.ReadFile(path)
	if err != nil {
		return info, err
	}
	err = json.Unmarshal(data, &info)
	return info, err
}

func removeRuntime(path string) { _ = os.Remove(path) }

// callRunning asks the running agent to do something (see the /internal routes in webui.go).
func callRunning(rt runtimeInfo, path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d%s", rt.Port, path), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Launch-Secret", rt.Secret)

	resp, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the running agent answered with status %d", resp.StatusCode)
	}
	return body, nil
}

// reopenRunning asks an agent that is already running for a fresh dashboard link.
// A leftover file from a crash simply fails to connect, and is treated as "not running".
func reopenRunning(runtimePath string) (string, bool) {
	rt, err := readRuntime(runtimePath)
	if err != nil {
		return "", false
	}
	body, err := callRunning(rt, "/internal/launch")
	if err != nil {
		return "", false
	}
	var out struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(body, &out) != nil || out.URL == "" {
		return "", false
	}
	return out.URL, true
}

// ---------- background mode ----------

// spawnBackground starts a copy of this program with no window or terminal,
// then returns. The copy knows it is the background one through FSAGENT_CHILD.
func spawnBackground() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Env = append(os.Environ(), "FSAGENT_CHILD=1")
	detachAttrs(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// ---------- the browser and the file manager ----------

// openBrowser opens a link in the person's default browser.
func openBrowser(link string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", link)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", link)
	default:
		cmd = exec.Command("xdg-open", link)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }() // clean up the helper process when it ends
	return nil
}

// openFolder shows a folder in the file manager (Explorer, Finder, ...).
func openFolder(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", dir)
	case "windows":
		cmd = exec.Command("explorer", dir) // explorer reports "failure" even when it works; we ignore the result
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// fileURL turns a file path into a file:// link (Windows paths included).
func fileURL(path string) string {
	p := filepath.ToSlash(path)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // C:/dir/file -> /C:/dir/file
	}
	return (&url.URL{Scheme: "file", Path: p}).String()
}

const errorPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>%s</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#14213d;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border:1px solid #e2e7f1;border-radius:16px;padding:28px;max-width:520px;margin:16px}
h1{font-size:1.25rem;margin:0 0 8px}.fix{background:#e6edfc;border-radius:12px;padding:12px 14px;margin-top:16px}</style></head>
<body><main><h1>%s</h1><p>%s</p><div class="fix"><strong>How to fix:</strong> %s</div></main></body></html>`

// showErrorInBrowser tells the person what went wrong when the agent can't start
// without a terminal: a small page is written to a temporary file and opened.
func showErrorInBrowser(f friendlyError) {
	fix := f.Hint
	if fix == "" {
		fix = "look at agent.log next to your settings file, or start the agent from a terminal to see more."
	}
	page := fmt.Sprintf(errorPage,
		template.HTMLEscapeString(displayName),
		template.HTMLEscapeString(f.Title),
		template.HTMLEscapeString(f.Detail),
		template.HTMLEscapeString(fix),
	)
	path := filepath.Join(os.TempDir(), "fsagent-error.html")
	if err := os.WriteFile(path, []byte(page), 0o600); err != nil {
		return
	}
	_ = openBrowser(fileURL(path))
}