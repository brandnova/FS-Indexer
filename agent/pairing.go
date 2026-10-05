package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/mdp/qrterminal/v3"
)

// pairingPayload is what the QR code encodes. The mobile app parses this
// JSON, stores it, and uses it for every later request.
type pairingPayload struct {
	V     int    `json:"v"`
	Host  string `json:"host"`
	Port  int    `json:"port"`
	Token string `json:"token"`
	ID    string `json:"id"`
	Name  string `json:"name"`
}

// PrintPairing shows the QR code plus the manual-entry fallback.
func PrintPairing(cfg *Config, host string) {
	if host == "" {
		fmt.Fprintln(os.Stderr, "\nCould not detect a LAN IP address. Are you connected to Wi-Fi?")
		fmt.Fprintf(os.Stderr, "You can set one with:  -host <ip>\n  Port:  %d\n  Token: %s\n\n", cfg.Port, cfg.Token)
		return
	}

	payload, _ := json.Marshal(pairingPayload{
		V:     1,
		Host:  host,
		Port:  cfg.Port,
		Token: cfg.Token,
		ID:    cfg.DeviceID,
		Name:  cfg.DeviceName,
	})

	fmt.Fprintln(os.Stderr, "\nScan this QR code in the mobile app to pair:")
	fmt.Fprintln(os.Stderr)
	qrterminal.GenerateHalfBlock(string(payload), qrterminal.L, os.Stderr)
	fmt.Fprintf(os.Stderr, "\nOr enter manually in the app:\n  Address: %s:%d\n  Token:   %s\n\n", host, cfg.Port, cfg.Token)

	if others := otherLANIPs(host); len(others) > 0 {
		fmt.Fprintf(os.Stderr, "Other addresses on this machine: %s\n(wrong one in the QR? run with -host <ip>)\n\n", strings.Join(others, ", "))
	}
}

// PreferredLANIP returns the IP of the interface used for the default route
// (found without sending any packets), falling back to the first private
// IPv4 address on a non-virtual interface.
func PreferredLANIP() string {
	if c, err := net.Dial("udp", "8.8.8.8:80"); err == nil {
		defer c.Close()
		if addr, ok := c.LocalAddr().(*net.UDPAddr); ok && addr.IP.IsPrivate() {
			return addr.IP.String()
		}
	}
	if ips := lanIPs(); len(ips) > 0 {
		return ips[0]
	}
	return ""
}

func otherLANIPs(primary string) []string {
	var out []string
	for _, ip := range lanIPs() {
		if ip != primary {
			out = append(out, ip)
		}
	}
	return out
}

func lanIPs() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || isVirtualIface(ifc.Name) {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip4 := ipnet.IP.To4(); ip4 != nil && ip4.IsPrivate() {
				out = append(out, ip4.String())
			}
		}
	}
	return out
}

func isVirtualIface(name string) bool {
	name = strings.ToLower(name)
	for _, p := range []string{"docker", "br-", "virbr", "veth", "vmnet", "vboxnet", "podman", "cni"} {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}