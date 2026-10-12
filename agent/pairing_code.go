package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/mdp/qrterminal/v3"
)

// pairingPayloadV2 is what the QR code carries now: where the PC is, and a one-time code.
// The permanent token is never in it.
type pairingPayloadV2 struct {
	V    int    `json:"v"`
	Host string `json:"host"`
	Port int    `json:"port"`
	Code string `json:"code"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

func pairingPayloadFor(cfg *Config, host, code string) string {
	b, _ := json.Marshal(pairingPayloadV2{V: 2, Host: host, Port: cfg.Port, Code: code, ID: cfg.DeviceID, Name: cfg.DeviceName})
	return string(b)
}

// PrintPairingCode shows the QR code and the code to type, in the terminal.
func PrintPairingCode(c *Console, cfg *Config, host string, codes *PairingCodes, drawQR bool) {
	code, expires := codes.Current()
	minutes := int(time.Until(expires).Round(time.Minute) / time.Minute)
	if minutes < 1 {
		minutes = 1
	}

	if host == "" {
		c.Warn("Couldn't work out this computer's network address. Are you connected to Wi-Fi?")
		c.Hint("You can set one with -host <ip>. The pairing code is " + formatCode(code))
		return
	}

	c.Blank()
	c.Text("To connect your phone, open the app and scan this QR code:")
	if drawQR {
		c.Blank()
		qrterminal.GenerateHalfBlock(pairingPayloadFor(cfg, host, code), qrterminal.L, os.Stderr)
	}
	c.Blank()
	c.Text(fmt.Sprintf(`Or choose "Enter details manually" and type:  address %s:%d   code %s`, host, cfg.Port, formatCode(code)))
	c.Hint(fmt.Sprintf("The code works once and runs out in about %d minutes. Run  %s -pair  (or use the dashboard) for a new one.", minutes, binaryName))
	if others := otherLANIPs(host); len(others) > 0 {
		c.Hint("Other addresses of this computer: " + strings.Join(others, ", "))
	}
}

// runPairCommand is  fsagent -pair : it asks the running agent for a code and shows it.
// It returns the exit code.
func runPairCommand(c *Console, runtimePath string, drawQR bool) int {
	rt, err := readRuntime(runtimePath)
	if err != nil {
		c.Text("The agent isn't running. Start it first: the pairing code appears on its start screen and in the dashboard.")
		return 1
	}
	body, err := callRunning(rt, "/internal/pair")
	if err != nil {
		c.Warn("Couldn't reach the running agent: " + err.Error())
		return 1
	}
	var out struct {
		Address   string `json:"address"`
		Code      string `json:"code"`
		ExpiresIn int    `json:"expires_in"`
		Payload   string `json:"payload"`
	}
	if json.Unmarshal(body, &out) != nil || out.Code == "" {
		c.Warn("The running agent gave an answer this version doesn't understand.")
		return 1
	}

	logs.Infof("pairing", "a pairing code was shown in the terminal")
	c.Blank()
	if out.Payload != "" && drawQR {
		c.Text("Scan this QR code in the app:")
		c.Blank()
		qrterminal.GenerateHalfBlock(out.Payload, qrterminal.L, os.Stderr)
		c.Blank()
	}
	if out.Address != "" {
		c.Text(fmt.Sprintf("Or type in the app:  address %s   code %s", out.Address, out.Code))
	} else {
		c.Text("The pairing code is " + out.Code + " (the agent couldn't work out this computer's address).")
	}
	c.Hint(fmt.Sprintf("The code works once and runs out in about %d minutes.", (out.ExpiresIn+59)/60))
	c.Blank()
	return 0
}