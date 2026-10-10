package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
)

// appDirName is the folder created inside the OS config directory.
// Change it together with the project name.
const appDirName = "fs-indexer"

// Root is one folder to index. Label becomes the first segment of every
// path under it (e.g. "Documents/cv/resume.pdf").
type Root struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

type Config struct {
	DeviceID        string   `json:"device_id"`
	DeviceName      string   `json:"device_name"`
	Port            int      `json:"port"`
	Token           string   `json:"token"`
	Roots           []Root   `json:"roots"`
	ExtraIgnores    []string `json:"extra_ignores"`
	IncludeHidden   bool     `json:"include_hidden"`
	AllowedNetworks []string `json:"allowed_networks"`

	allowedNets  []*net.IPNet // parsed AllowedNetworks; not saved
	firstRun     bool         // this run created the settings file
	defaultRoots bool         // "roots" was empty, so the standard folders are used
}

// ---------- where the config lives ----------

// DefaultConfigPath is <user config dir>/fs-indexer/config.json:
// ~/.config on Linux, %AppData% on Windows, ~/Library/Application Support on macOS.
func DefaultConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		return "config.json"
	}
	return filepath.Join(dir, appDirName, "config.json")
}

// ResolveConfigPath picks the config file to use and returns an optional
// notice to show the user.
func ResolveConfigPath(flagValue string) (path string, notice string) {
	def := DefaultConfigPath()
	return pickConfigPath(flagValue, fileExists(def), fileExists("config.json"), def)
}

// pickConfigPath order: -config flag, then the default location if it exists,
// then a legacy ./config.json, then the default location (created on first run).
func pickConfigPath(flagValue string, defaultExists, legacyExists bool, defaultPath string) (string, string) {
	switch {
	case flagValue != "":
		return flagValue, ""
	case defaultExists:
		return defaultPath, ""
	case legacyExists:
		return "config.json", fmt.Sprintf(
			"using ./config.json from the current folder. New installs keep it at %s; move it there (or pass -config) to run from anywhere.",
			defaultPath,
		)
	default:
		return defaultPath, ""
	}
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// ---------- loading and saving ----------

// LoadConfig reads the config file. If it doesn't exist it is created with
// safe defaults, and any missing id/token is generated and saved back, so the
// agent runs with zero manual setup. With no folders configured it falls back
// to the OS's standard folders (Documents, Downloads, ...).
func LoadConfig(configPath string) (*Config, error) {
	cfg := &Config{}
	created := false

	data, err := os.ReadFile(configPath)
	switch {
	case errors.Is(err, os.ErrNotExist):
		cfg = defaultConfig()
		created = true
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse %s: %w", configPath, err)
		}
	}

	changed := cfg.applyDefaults()

	if len(cfg.Roots) == 0 {
		if roots := DefaultRoots(); len(roots) > 0 {
			cfg.Roots = roots
			cfg.defaultRoots = true
			changed = true
		}
	}

	if created || changed {
		if err := saveConfig(configPath, cfg); err != nil {
			return nil, err
		}
	}
	cfg.firstRun = created

	if err := cfg.normalizeRoots(); err != nil {
		return nil, err
	}
	if err := cfg.parseAllowedNetworks(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// ReadConfig reads an existing config without creating, normalizing or
// rewriting anything. Used by -pair, which must never touch the file.
func ReadConfig(configPath string) (*Config, error) {
	cfg, err := readRaw(configPath)
	if err != nil {
		return nil, err
	}
	if cfg.Token == "" || cfg.DeviceID == "" {
		return nil, fmt.Errorf("%s is incomplete - run the agent once to finish setting it up", configPath)
	}
	cfg.applyDefaults()
	return cfg, nil
}

// RotateToken replaces the access token and saves the file. Roots are written
// back exactly as the user wrote them (e.g. "~/Documents" stays "~/Documents").
func RotateToken(configPath string) (*Config, error) {
	cfg, err := readRaw(configPath)
	if err != nil {
		return nil, err
	}
	cfg.applyDefaults()
	cfg.Token = randomHex(16)
	if err := saveConfig(configPath, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func readRaw(configPath string) (*Config, error) {
	data, err := os.ReadFile(configPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%s does not exist yet - run the agent once to create it", configPath)
	}
	if err != nil {
		return nil, err
	}
	cfg := &Config{}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", configPath, err)
	}
	return cfg, nil
}

func defaultConfig() *Config {
	return &Config{
		Roots:           []Root{},
		ExtraIgnores:    []string{},
		AllowedNetworks: []string{},
	}
}

// applyDefaults fills in missing values and reports whether anything changed.
func (c *Config) applyDefaults() bool {
	changed := false
	if c.DeviceID == "" {
		c.DeviceID = randomHex(8)
		changed = true
	}
	if c.DeviceName == "" {
		host, err := os.Hostname()
		if err != nil || host == "" {
			host = "My PC"
		}
		c.DeviceName = host
		changed = true
	}
	if c.Port == 0 {
		c.Port = 8080
		changed = true
	}
	if c.Token == "" {
		c.Token = randomHex(16)
		changed = true
	}
	if c.ExtraIgnores == nil {
		c.ExtraIgnores = []string{}
		changed = true
	}
	if c.AllowedNetworks == nil {
		c.AllowedNetworks = []string{}
		changed = true
	}
	return changed
}

// normalizeRoots expands ~, resolves to absolute real paths, fills labels,
// and checks that every root exists and has a unique label.
func (c *Config) normalizeRoots() error {
	if len(c.Roots) == 0 {
		return errors.New(`no roots configured and no standard folders were found - add at least one folder to "roots" in the config file`)
	}

	home, _ := os.UserHomeDir()
	seen := map[string]bool{}

	for i := range c.Roots {
		r := &c.Roots[i]

		p := r.Path
		if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
			p = filepath.Join(home, p[1:])
		}

		abs, err := filepath.Abs(p)
		if err != nil {
			return fmt.Errorf("root %q: %w", r.Path, err)
		}
		real, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return fmt.Errorf("root %q: %w", r.Path, err)
		}
		st, err := os.Stat(real)
		if err != nil {
			return fmt.Errorf("root %q: %w", r.Path, err)
		}
		if !st.IsDir() {
			return fmt.Errorf("root %q is not a directory", r.Path)
		}
		r.Path = real

		if r.Label == "" {
			r.Label = filepath.Base(real)
		}
		if r.Label == "" || r.Label == "." || r.Label == string(filepath.Separator) || strings.ContainsAny(r.Label, `/\`) {
			return fmt.Errorf("root %q needs a simple \"label\" (no slashes)", r.Path)
		}
		key := strings.ToLower(r.Label)
		if seen[key] {
			return fmt.Errorf("duplicate root label %q - give each root a unique label", r.Label)
		}
		seen[key] = true
	}
	return nil
}

// parseAllowedNetworks validates "allowed_networks": extra networks (CIDR
// notation, e.g. Tailscale's 100.64.0.0/10) that may connect in addition to
// the local network. Ranges big enough to cover much of the internet are refused.
func (c *Config) parseAllowedNetworks() error {
	c.allowedNets = nil
	for _, s := range c.AllowedNetworks {
		_, n, err := net.ParseCIDR(strings.TrimSpace(s))
		if err != nil {
			return fmt.Errorf("allowed_networks: %q is not a network like 100.64.0.0/10", s)
		}
		ones, bits := n.Mask.Size()
		if (bits == 32 && ones < 8) || (bits == 128 && ones < 16) {
			return fmt.Errorf("allowed_networks: %q is too broad: it would allow a large part of the internet", s)
		}
		c.allowedNets = append(c.allowedNets, n)
	}
	return nil
}

func rootLabels(roots []Root) string {
	labels := make([]string, len(roots))
	for i, r := range roots {
		labels[i] = r.Label
	}
	return strings.Join(labels, ", ")
}

func saveConfig(configPath string, cfg *Config) error {
	if dir := filepath.Dir(configPath); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	// 0600: the file contains the access token.
	return os.WriteFile(configPath, append(data, '\n'), 0o600)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}