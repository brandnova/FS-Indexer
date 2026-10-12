//go:build linux

package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// firewallState asks firewalld, when it is running, whether it lets a TCP port in.
// It returns "open", "closed", or "" when it can't tell (no firewalld, or no permission to ask).
func firewallState(port int) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	state, err := exec.CommandContext(ctx, "firewall-cmd", "--state").Output()
	if err != nil || strings.TrimSpace(string(state)) != "running" {
		return ""
	}
	// "--query-port" prints yes or no (and exits 1 for no, so the exit status is ignored).
	out, _ := exec.CommandContext(ctx, "firewall-cmd", fmt.Sprintf("--query-port=%d/tcp", port)).Output()
	switch strings.TrimSpace(string(out)) {
	case "yes":
		return "open"
	case "no":
		return "closed"
	}
	return ""
}