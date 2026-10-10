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
	background := flag.Bool("background", false, "run in the background with no window; the dashboard opens in your browser")
	openUI := flag.Bool("ui", false, "open the dashboard in your browser, starting the agent in the background if needed")
	stopAgent := flag.Bool("stop", false, "stop the agent that is running in the background")
	noWeb := flag.Bool("no-web", false, "don't start the dashboard")
	noOpen := flag.Bool("no-open", false, "don't open the browser automatically")
	flag.BoolVar(&verbose, "verbose", false, "list every path that couldn't be read while scanning")
	flag.Parse()

	log.SetFlags(0)

	if *showVersion {
		fmt.Printf("%s %s (%s %s/%s)\n", binaryName, version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return
	}

	talk := NewConsole(os.Stderr, false, *noColor) // commands the user asked for always speak up
	isChild := os.Getenv("FSAGENT_CHILD") == "1"   // true in the detached background copy
	backgroundMode = isChild

	configPath, notice := ResolveConfigPath(*configFlag)
	runtimePath := siblingPath(configPath, "runtime.json", ".runtime.json")

	// Stop an agent that runs in the background.
	if *stopAgent {
		rt, err := readRuntime(runtimePath)
		if err != nil {
			talk.Text("The agent doesn't seem to be running.")
			return
		}
		if _, err := callRunning(rt, "/internal/quit"); err != nil {
			talk.Warn("Couldn't reach the running agent: " + err.Error())
			os.Exit(1)
		}
		talk.OK("Stopped", "the agent was asked to stop")
		return
	}

	// A click (Windows Explorer), -ui or -background: show the dashboard of the
	// running agent, or start one in the background.
	if !isChild && (*background || *openUI || (flag.NFlag() == 0 && startedByExplorer())) {
		if link, ok := reopenRunning(runtimePath); ok {
			talk.Text("The agent is already running. Opening the dashboard...")
			if err := openBrowser(link); err != nil {
				talk.Text("Open this link in your browser: " + link)
			}
			return
		}
		if err := spawnBackground(); err != nil {
			fail(talk, friendlyError{Title: "Couldn't start the agent in the background", Detail: err.Error()})
		}
		talk.Text("Starting in the background. Your browser will open the dashboard.")
		return
	}

	con := NewConsole(os.Stderr, *quiet, *noColor)
	if isChild {
		// No terminal here: everything the agent says goes to a log file instead.
		if logFile, err := openLogFile(siblingPath(configPath, "agent.log", ".log")); err == nil {
			defer logFile.Close()
			log.SetOutput(logFile)
			con = newConsoleFor(logFile, false, false)
		}
	}

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

	// Only one agent at a time: if one is running, just show its dashboard.
	webEnabled := !*noWeb && !cfg.DisableWebUI
	if webEnabled {
		if link, ok := reopenRunning(runtimePath); ok {
			con.Text("The agent is already running.")
			if *noOpen {
				con.Text("Dashboard link: " + link)
			} else if err := openBrowser(link); err != nil {
				con.Text("Open this link in your browser: " + link)
			}
			return
		}
	}

	ctx, shutdown := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer shutdown()

	events := NewEventLog(50)
	ix := NewIndexer(cfg)
	var scans atomic.Int32
	ix.OnScan = func(r ScanResult) {
		reportScan(con, cfg, r, scans.Add(1) == 1)
		events.Addf("Scanned your folders: %s items in %s", commas(r.Entries), roundDuration(r.Duration))
	}
	activity = func(format string, args ...any) {
		con.Activity(format, args...)
		events.Addf(format, args...)
	}

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

	// The dashboard, for the person at this computer.
	var ui *WebUI
	var uiSrv *http.Server
	if webEnabled {
		u, err := NewWebUI(WebOptions{
			Config:     cfg,
			Indexer:    ix,
			Events:     events,
			ConfigPath: configPath,
			HostFlag:   *hostFlag,
			Discovery:  discovery,
			Quit:       shutdown,
		})
		if err != nil {
			con.Warn("The dashboard couldn't start: " + err.Error())
		} else if uiLn, err := u.Listen(cfg.WebPort); err != nil {
			con.Warn("The dashboard couldn't start: " + err.Error())
		} else {
			ui = u
			uiSrv = &http.Server{Handler: ui.Handler(), ReadHeaderTimeout: 10 * time.Second}
			go func() { _ = uiSrv.Serve(uiLn) }()
			if err := writeRuntime(runtimePath, runtimeInfo{Port: ui.port, Secret: ui.secret}); err != nil {
				con.Warn("Couldn't record that the dashboard is running: " + err.Error())
			}
			defer removeRuntime(runtimePath)
		}
	}

	info := startupInfo{
		ConfigPath:  configPath,
		Notice:      notice,
		Host:        host,
		Discovery:   discovery,
		DiscoveryOK: discoveryOK,
	}
	if ui != nil {
		info.Dashboard = ui.BaseURL() + "  (this computer only)"
	}
	events.Addf("Agent started (%s)", versionLabel())
	printBanner(con, cfg, info)

	if !isChild { // a log file must never contain the token, so the pairing details stay on screen only
		PrintPairing(con, cfg, host, !*noQR)
		if ui != nil {
			con.Blank()
			con.Text("Dashboard link (works once):  " + ui.LoginURL(15*time.Minute, ""))
			con.Hint("Lost it? Run  " + binaryName + " -ui  for a fresh link.")
		}
		con.Blank()
		con.Text("Keep this window open while you use the app. Press Ctrl+C to stop.")
		con.Blank()
	}

	// Open the dashboard by itself on the very first start, and whenever there is no terminal to look at.
	if ui != nil && !*noOpen && !*quiet && (cfg.firstRun || isChild) {
		next := ""
		if cfg.firstRun {
			next = "pair"
		}
		if err := openBrowser(ui.LoginURL(2*time.Minute, next)); err != nil {
			con.Warn("Couldn't open your browser. Run  " + binaryName + " -ui  or visit " + ui.BaseURL())
		}
	}

	// Start scanning only now, so its result appears below the banner.
	ix.StartScan()

	<-ctx.Done()

	con.Blank()
	con.Text("Stopping...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	if uiSrv != nil {
		_ = uiSrv.Shutdown(shutdownCtx)
	}
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