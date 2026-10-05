package main

import (
	"net"

	"github.com/grandcat/zeroconf"
)

// Service type the phone scans for.
const mdnsService = "_fs-sync._tcp"

// StartMDNS advertises the agent on the local network. The TXT record carries
// identity only (never the token): discovery shows that a PC exists, pairing
// proves you're allowed to use it.
func StartMDNS(cfg *Config, host string) (*zeroconf.Server, error) {
	instance := "fs-sync-" + shortID(cfg.DeviceID)
	txt := []string{"v=1", "id=" + cfg.DeviceID, "name=" + cfg.DeviceName}
	return zeroconf.Register(instance, mdnsService, "local.", cfg.Port, txt, ifacesFor(host))
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// ifacesFor limits advertising to the interface that owns `host`, so we don't
// announce ourselves on docker or VM bridges. Returns nil (all interfaces) if
// the interface can't be determined.
func ifacesFor(host string) []net.Interface {
	ip := net.ParseIP(host)
	if ip == nil {
		return nil
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, ifc := range ifaces {
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.Equal(ip) {
				return []net.Interface{ifc}
			}
		}
	}
	return nil
}