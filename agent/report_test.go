package main

import (
	"strings"
	"testing"
)

func TestReportHidesPrivateDetails(t *testing.T) {
	t.Setenv("HOME", "/home/tester")
	t.Setenv("USERPROFILE", "/home/tester")
	cfg := &Config{
		DeviceID: "0123456789abcdef", DeviceName: "pc", Port: 8080, WebPort: 8765,
		Token: "supersecrettoken1234", Roots: []Root{{Path: "/home/tester/Documents", Label: "Documents"}},
	}
	in := ReportInput{
		Config: cfg, ConfigPath: "/home/tester/.config/x/config.json", LogPath: "/home/tester/.config/x/agent.log",
		Mode:     "test",
		LogLines: []string{"2026-10-11 10:00:00 INFO  [phone] 192.168.1.23 copied the file list from /home/tester/Documents"},
		MaskIPs:  true,
	}

	text := BuildReport(in)
	for _, leaked := range []string{"supersecrettoken1234", "/home/tester", "192.168.1.23"} {
		if strings.Contains(text, leaked) {
			t.Errorf("the report leaks %q:\n%s", leaked, text)
		}
	}
	for _, want := range []string{"agent report", "[token removed]", "~/Documents", "192.168.x.x", "copied the file list"} {
		if !strings.Contains(text, want) {
			t.Errorf("the report is missing %q", want)
		}
	}

	in.MaskIPs = false
	if text := BuildReport(in); !strings.Contains(text, "192.168.1.23") {
		t.Error("IP addresses should stay when masking is off")
	}
}