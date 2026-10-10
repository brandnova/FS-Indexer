package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"
)

const binaryName = "fsagent"

func main() {
	configFlag := flag.String("config", "", "path to the settings file (default: <user config dir>/"+appDirName+"/config.json)")
	dump := flag.Bool("dump", false, "print the file list as NDJSON to stdout and exit")
	hostFlag := flag.String("host", "", "override the IP address shown in the pairing QR code")
	noMDNS := flag.Bool("no-mdns", false, "don't let the app find this computer automatically")
	showVersion := flag.Bool("version", false, "print the version and exit")
	pair := flag.Bool("pair", false, "show the pairing QR code and token, then exit (does not start the agent)")
	rotate := flag.Bool("rotate-token", false, "create a new access token, show the pairing QR code, then exit")
	quiet := flag.Bool("quiet", false, "print only warnings and errors (no banner, QR code or token)")
	noQR := flag.Bool("no-qr", false, "don't draw the QR code; show the address and token only")
	noColor := flag.Bool("no-color", false, "turn off colours (the NO_COLOR environment variable works too)")
	flag.BoolVar(&verbose, "verbose", false, "list every path that couldn't be read while scanning")
	flag.Parse()

	log.SetFlags(0)

	if *showVersion {
		fmt.Printf("%s %s (%s %s/%s)\n", binaryName, version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return
	}

	con := NewConsole(os.Stderr, *quiet, *noColor)
	talk := NewConsole(os.Stderr, false, *noColor) // commands the user asked for always speak up

	configPath, notice := ResolveConfigPath(*configFlag)

	// Maintenance commands: touch the settings, print, exit. No server.
	if *rotate {
		cfg, err := RotateToken(configPath)
		if err != nil {
			fail(talk, explainConfigError(configPath, err))
		}
		talk.Blank()
		talk.OK("Token", "a new access token was saved")
		talk.Hint("Restart the agent for it to take effect, then pair your phones again.")
		PrintPairing(talk, cfg, hostOrDetect(*hostFlag), !*noQR)
		talk.Blank()
		return
	}
	if *pair {
		cfg, err := ReadConfig(configPath)
		if err != nil {
			fail(talk, explainConfigError(configPath, err))
		}
		PrintPairing(talk, cfg, hostOrDetect(*hostFlag), !*noQR)
		talk.Blank()
		return
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		fail(con, explainConfigError(configPath, err))
	}

	// Debug mode: crawl once, print, exit. No server.
	if *dump {
		entries, _ := Crawl(cfg)
		if err := dumpNDJSON(entries); err != nil {
			fail(talk, friendlyError{Title: "Couldn't write the file list", Detail: err.Error()})
		}
		return
	}

	ix := NewIndexer(cfg)
	var scans atomic.Int32
	ix.OnScan = func(r ScanResult) {
		reportScan(con, cfg, r, scans.Add(1) == 1)
	}
	activity = con.Activity

	srv := NewServer(cfg, ix)

	// Listen first so a busy port fails before we show anything else.
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		fail(con, explainListenError(srv.Addr, err))
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fail(con, friendlyError{Title: "The agent stopped unexpectedly", Detail: err.Error()})
		}
	}()

	host := hostOrDetect(*hostFlag)

	// Automatic discovery is a convenience: if it fails, everything else still works.
	discovery, discoveryOK := "off (started with -no-mdns)", false
	if !*noMDNS {
		m, err := StartMDNS(cfg, host)
		if err != nil {
			discovery = "unavailable (" + err.Error() + "). You can still connect with the QR code."
		} else {
			defer m.Shutdown()
			discovery, discoveryOK = "the app can find this computer by itself", true
		}
	}

	printBanner(con, cfg, startupInfo{
		ConfigPath:  configPath,
		Notice:      notice,
		Host:        host,
		Discovery:   discovery,
		DiscoveryOK: discoveryOK,
	})
	PrintPairing(con, cfg, host, !*noQR)
	con.Blank()
	con.Text("Keep this window open while you use the app. Press Ctrl+C to stop.")
	con.Blank()

	// Start scanning only now, so its result appears below the banner.
	ix.StartScan()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	con.Blank()
	con.Text("Stopping...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func hostOrDetect(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	return PreferredLANIP()
}

func dumpNDJSON(entries []Entry) error {
	w := bufio.NewWriter(os.Stdout)

	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, e := range entries {
		if err := enc.Encode(e); err != nil {
			return err
		}
	}
	return w.Flush()
}