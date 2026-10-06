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
	"syscall"
	"time"
)

const binaryName = "fsagent"

func main() {
	configFlag := flag.String("config", "", "path to the config file (default: <user config dir>/"+appDirName+"/config.json)")
	dump := flag.Bool("dump", false, "print the index as NDJSON to stdout and exit")
	hostFlag := flag.String("host", "", "override the IP address encoded in the pairing QR code")
	noMDNS := flag.Bool("no-mdns", false, "don't advertise this agent on the local network")
	showVersion := flag.Bool("version", false, "print the version and exit")
	pair := flag.Bool("pair", false, "print the pairing QR code and token, then exit (does not start the server)")
	rotate := flag.Bool("rotate-token", false, "generate a new access token, print the pairing QR code, then exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("%s %s (%s %s/%s)\n", binaryName, version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return
	}

	configPath, notice := ResolveConfigPath(*configFlag)
	if notice != "" {
		log.Println(notice)
	}

	// Maintenance commands: touch the config, print, exit. No server.
	if *rotate {
		cfg, err := RotateToken(configPath)
		if err != nil {
			log.Fatalf("rotate token: %v", err)
		}
		fmt.Fprintln(os.Stderr, "New token saved. Restart the agent for it to take effect, then re-pair your phones.")
		PrintPairing(cfg, hostOrDetect(*hostFlag))
		return
	}
	if *pair {
		cfg, err := ReadConfig(configPath)
		if err != nil {
			log.Fatalf("pair: %v", err)
		}
		PrintPairing(cfg, hostOrDetect(*hostFlag))
		return
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		log.Fatalf("config %s: %v", configPath, err)
	}
	log.Printf("config: %s", configPath)

	// Debug mode: crawl once, print, exit. No server.
	if *dump {
		entries, _ := Crawl(cfg)
		dumpNDJSON(entries)
		return
	}

	ix := NewIndexer(cfg)
	ix.StartScan() // runs in the background; the server comes up immediately

	srv := NewServer(cfg, ix)

	// Listen first so a busy port fails before we print a QR code.
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		log.Fatalf("cannot listen on %s: %v", srv.Addr, err)
	}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	host := hostOrDetect(*hostFlag)
	log.Printf("%s %s: %s (%s) listening on %s", binaryName, version, cfg.DeviceName, cfg.DeviceID, srv.Addr)

	// mDNS is a convenience: if it fails, everything else still works.
	if !*noMDNS {
		if m, err := StartMDNS(cfg, host); err != nil {
			log.Printf("mDNS advertising disabled: %v", err)
		} else {
			defer m.Shutdown()
			log.Printf("advertising %s on the local network", mdnsService)
		}
	}

	PrintPairing(cfg, host)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()

	log.Println("shutting down...")
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

func dumpNDJSON(entries []Entry) {
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()

	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, e := range entries {
		if err := enc.Encode(e); err != nil {
			log.Fatalf("encode: %v", err)
		}
	}
}