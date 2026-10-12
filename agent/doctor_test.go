package main

import (
	"errors"
	"net"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func findCheck(checks []Check, id string) *Check {
	for i := range checks {
		if checks[i].ID == id {
			return &checks[i]
		}
	}
	return nil
}

func folderEnv(roots ...Root) *doctorEnv {
	return &doctorEnv{DoctorInput: DoctorInput{Config: &Config{Roots: roots}}}
}

// startTestAgent runs the real phone API on a random port, with one tiny shared folder.
func startTestAgent(t *testing.T) *Config {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := &Config{
		DeviceID: "0123456789abcdef", DeviceName: "test-pc", Port: 8080, WebPort: 8765, Token: testToken,
		Roots: []Root{{Path: resolvedPath(root), Label: "Root"}}, ExtraIgnores: []string{},
	}
	ix := NewIndexer(cfg)
	ix.StartScan()
	waitForScan(t, ix)

	ts := httptest.NewServer(NewServer(cfg, ix).Handler)
	t.Cleanup(ts.Close)
	u, _ := url.Parse(ts.URL)
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	cfg.Port = port
	return cfg
}

func TestDoctorBrokenSettings(t *testing.T) {
	checks := RunDoctor(DoctorInput{
		ConfigPath: "/x/config.json",
		ConfigErr:  errors.New("parse /x/config.json: invalid character 'x'"),
	})
	if len(checks) == 0 || checks[0].ID != "settings" {
		t.Fatalf("the settings check should come first: %+v", checks)
	}
	if s := checks[0]; s.Status != StatusFail || s.Fix == "" {
		t.Errorf("a broken file should fail with a fix: %+v", s)
	}
	for _, id := range []string{"folders", "agent", "phone-port"} {
		if findCheck(checks, id) != nil {
			t.Errorf("%s can't run without settings", id)
		}
	}
}

func TestDoctorMissingSettingsIsOnlyAWarning(t *testing.T) {
	checks := RunDoctor(DoctorInput{
		ConfigPath: "/x/config.json",
		ConfigErr:  errors.New("/x/config.json does not exist yet - run the agent once to create it"),
	})
	if s := findCheck(checks, "settings"); s == nil || s.Status != StatusWarn {
		t.Errorf("a first start hasn't happened yet, which isn't a failure: %+v", s)
	}
}

func TestDoctorSettingsPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file permissions work differently on Windows")
	}
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := &Config{DeviceID: "id", Port: 8080, WebPort: 8765, Token: "t"}
	if err := saveConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	env := &doctorEnv{DoctorInput: DoctorInput{Config: cfg, ConfigPath: path}}

	if res, _ := checkSettings(env); res.Status != StatusOK {
		t.Errorf("a private file should be fine: %+v", res)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if res, _ := checkSettings(env); res.Status != StatusWarn || !strings.Contains(res.Fix, "chmod") {
		t.Errorf("a file other users can read should warn: %+v", res)
	}
}

func TestDoctorFolders(t *testing.T) {
	good, other := t.TempDir(), t.TempDir()

	res, _ := checkFolders(folderEnv(Root{Path: good, Label: "A"}, Root{Path: other, Label: "B"}))
	if res.Status != StatusOK {
		t.Errorf("two real folders should be fine: %+v", res)
	}

	res, _ = checkFolders(folderEnv(Root{Path: good, Label: "A"}, Root{Path: filepath.Join(good, "nope"), Label: "Gone"}))
	if res.Status != StatusFail || !strings.Contains(res.Detail, "Gone") {
		t.Errorf("a missing folder should fail and name it: %+v", res)
	}

	res, _ = checkFolders(folderEnv(Root{Path: filepath.Join(good, "nope"), Label: "Off", Disabled: true}))
	if res.Status != StatusWarn || !strings.Contains(res.Detail, "No folders are switched on") {
		t.Errorf("a switched-off folder is ignored, leaving nothing to share: %+v", res)
	}

	sub := filepath.Join(good, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	res, _ = checkFolders(folderEnv(Root{Path: good, Label: "A"}, Root{Path: sub, Label: "Sub"}))
	if res.Status != StatusWarn || !strings.Contains(res.Detail, "twice") {
		t.Errorf("overlapping folders should warn: %+v", res)
	}
}

func TestDoctorPhonePort(t *testing.T) {
	// A port that something else holds, and that answers nothing useful.
	busy, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { busy.Close() })
	go func() {
		for {
			c, err := busy.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	port := busy.Addr().(*net.TCPAddr).Port

	e := &doctorEnv{DoctorInput: DoctorInput{Config: &Config{Port: port, Token: "x"}}}
	if res, _ := checkPhonePort(e); res.Status != StatusFail || res.Fix == "" {
		t.Errorf("a busy port should fail with a fix: %+v", res)
	}

	free, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	freePort := free.Addr().(*net.TCPAddr).Port
	free.Close()

	e = &doctorEnv{DoctorInput: DoctorInput{Config: &Config{Port: freePort, Token: "x"}}}
	if res, _ := checkPhonePort(e); res.Status != StatusOK || !strings.Contains(res.Detail, "free") {
		t.Errorf("a free port should be fine: %+v", res)
	}
	if res, _ := checkAgent(e); res.Status != StatusInfo {
		t.Errorf("no agent running should be information, not a failure: %+v", res)
	}
	if _, ok := checkIndex(e); ok {
		t.Error("the file list can't be checked without a running agent")
	}
}

func TestDoctorSeesARunningAgent(t *testing.T) {
	cfg := startTestAgent(t)
	e := &doctorEnv{DoctorInput: DoctorInput{Config: cfg}}

	if res, ok := checkAgent(e); !ok || res.Status != StatusOK || !strings.Contains(res.Detail, "Running") {
		t.Errorf("a running agent should be recognised: %+v", res)
	}
	if res, ok := checkIndex(e); !ok || res.Status != StatusOK {
		t.Errorf("a scanned folder should give a healthy file list: %+v", res)
	}
	if res, _ := checkPhonePort(e); res.Status != StatusOK || !strings.Contains(res.Detail, "listening") {
		t.Errorf("the port should be reported as in use by the agent: %+v", res)
	}

	wrong := cfg.clone()
	wrong.Token = "not-the-token"
	we := &doctorEnv{DoctorInput: DoctorInput{Config: wrong}}
	if res, _ := checkAgent(we); res.Status != StatusFail || !strings.Contains(res.Detail, "token") {
		t.Errorf("a different token should be reported: %+v", res)
	}

	other := cfg.clone()
	other.DeviceID = "ffffffffffffffff"
	oe := &doctorEnv{DoctorInput: DoctorInput{Config: other}}
	if res, _ := checkAgent(oe); res.Status != StatusWarn {
		t.Errorf("a different device ID should warn: %+v", res)
	}
}

func TestDoctorLogOnlyCountsRecentProblems(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	old := "2020-01-01 10:00:00 ERROR [scan] ancient problem\n"
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	e := &doctorEnv{DoctorInput: DoctorInput{LogPath: path}}

	if res, ok := checkLog(e); !ok || res.Status != StatusOK {
		t.Errorf("an old error should not count: %+v", res)
	}

	fresh := time.Now().Format("2006-01-02 15:04:05") + " ERROR [scan] fresh problem\n"
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString(fresh)
	f.Close()

	res, _ := checkLog(e)
	if res.Status != StatusWarn || !strings.Contains(res.Detail, "fresh problem") || strings.Contains(res.Detail, "ancient") {
		t.Errorf("a recent error should warn, without the old one: %+v", res)
	}
}

func TestCountChecks(t *testing.T) {
	ok, warn, fail := countChecks([]Check{
		{Status: StatusOK}, {Status: StatusInfo}, {Status: StatusWarn}, {Status: StatusFail}, {Status: StatusFail},
	})
	if ok != 2 || warn != 1 || fail != 2 {
		t.Errorf("counts = %d %d %d", ok, warn, fail)
	}
}

func TestPhoneTipsUseTheAddress(t *testing.T) {
	tips := phoneTips("192.168.1.5:8080")
	if len(tips) < 3 || !strings.Contains(tips[2], "http://192.168.1.5:8080/api/v1/ping") {
		t.Errorf("unexpected tips: %v", tips)
	}
	if !strings.Contains(phoneTips("")[2], "ADDRESS:PORT") {
		t.Error("an unknown address should show a placeholder")
	}
}
