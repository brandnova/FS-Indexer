//go:build !linux

package main

// firewallState can only ask firewalld, which exists on Linux. Elsewhere it can't tell.
func firewallState(port int) string { return "" }