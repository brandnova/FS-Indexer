package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	dump := flag.Bool("dump", false, "print the index as NDJSON to stdout and exit")
	hostFlag := flag.String("host", "", "override the IP address encoded in the pairing QR code")
	noMDNS := flag.Bool("no-mdns", false, "don't advertise this agent on the local network")
	flag.Parse()

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

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

	host := *hostFlag
	if host == "" {
		host = PreferredLANIP()
	}
	log.Printf("%s (%s) listening on %s", cfg.DeviceName, cfg.DeviceID, srv.Addr)

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