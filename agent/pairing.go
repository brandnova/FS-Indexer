package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
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

// PrintPairing shows the QR code (unless showQR is false) and the manual details.
func PrintPairing(c *Console, cfg *Config, host string, showQR bool) {
	c.Blank()

	if host == "" {
		c.Warn("Couldn't work out this computer's network address. Are you connected to Wi-Fi or a network cable?")
		c.Hint("You can set it yourself by starting the agent with:  -host <this computer's address>")
		c.Blank()
		c.Text("In the app, choose \"Enter details manually\" and type:")
		printManual(c, "<this computer's address>:"+fmt.Sprint(cfg.Port), cfg)
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

	if showQR {
		c.Text("Scan this QR code with the app to connect:")
		c.Blank()
		c.WithWriter(func(w io.Writer) {
			qrterminal.GenerateHalfBlock(string(payload), qrterminal.L, w)
		})
		c.Blank()
		c.Text(`Can't scan? In the app choose "Enter details manually" and type:`)
	} else {
		c.Text(`To connect, open the app, choose "Enter details manually" and type:`)
	}
	printManual(c, fmt.Sprintf("%s:%d", host, cfg.Port), cfg)

	if others := otherLANIPs(host); len(others) > 0 {
		c.Blank()
		c.Hint("This computer also has the addresses " + strings.Join(others, ", ") + ".")
		c.Hint("If the QR code shows the wrong one, start the agent with:  -host <address>")
	}
}

func printManual(c *Console, address string, cfg *Config) {
	c.Blank()
	c.Text("    Address   " + address)
	c.Text("    Token     " + cfg.Token)
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