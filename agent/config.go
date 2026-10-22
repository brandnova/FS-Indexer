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
const appDirName = "perigee"

// Root is one folder to index. Label becomes the first segment of every
// path under it (e.g. "Documents/cv/resume.pdf").
type Root struct {
	Path          string `json:"path"`
	Label         string `json:"label,omitempty"`
	Disabled      bool   `json:"disabled,omitempty"`       // switched off: kept in the settings, not shared
	IncludeHidden bool   `json:"include_hidden,omitempty"` // also share hidden files in this folder
}

type Config struct {
	DeviceID        string   `json:"device_id"`
	DeviceName      string   `json:"device_name"`
	Port            int      `json:"port"`
	WebPort         int      `json:"web_port"`
	DisableWebUI    bool     `json:"disable_web_ui"`
	Token           string   `json:"token"`
	Roots           []Root   `json:"roots"`
	ExtraIgnores    []string `json:"extra_ignores"`
	IncludeHidden   bool     `json:"include_hidden"`
	AllowedNetworks []string `json:"allowed_networks"`
	// DisableLegacyToken stops the old shared token from working. New installs start with it
	// switched off; settings files from before per-phone keys keep it on until the person turns it off.
	DisableLegacyToken bool `json:"disable_legacy_token"`
	// AllowFileAccess lets paired phones open and download the files the agent lists, not only see
	// their names. Off unless the person turns it on.
	AllowFileAccess bool `json:"allow_file_access"`

	// Receiving files from paired phones into one drop folder, within limits. Off unless switched on.
	AllowUploads        bool   `json:"allow_uploads"`
	UploadDir           string `json:"upload_dir"`
	UploadMaxMB         int    `json:"upload_max_mb"`         // 0 means the default (100)
	UploadPerHour       int    `json:"upload_per_hour"`       // 0 means the default (30)
	UploadAllowPrograms bool   `json:"upload_allow_programs"` // .exe, .sh and similar

	allowedNets  []*net.IPNet // parsed AllowedNetworks; not saved
	firstRun     bool         // this run created the settings file
	defaultRoots bool         // "roots" was empty, so the standard folders are used
}

// clone makes an independent copy, so settings can be changed without touching
// the copy a running scan is using.
func (c *Config) clone() *Config {
	n := *c
	n.Roots = append(make([]Root, 0, len(c.Roots)), c.Roots...)
	n.ExtraIgnores = append(make([]string, 0, len(c.ExtraIgnores)), c.ExtraIgnores...)
	n.AllowedNetworks = append(make([]string, 0, len(c.AllowedNetworks)), c.AllowedNetworks...)
	n.allowedNets = append([]*net.IPNet(nil), c.allowedNets...)
	return &n
}

// enabledRoots are the folders that are switched on.
func (c *Config) enabledRoots() []Root {
	out := make([]Root, 0, len(c.Roots))
	for _, r := range c.Roots {
		if !r.Disabled {
			out = append(out, r)
		}
	}
	return out
}

// ---------- where the config lives ----------

// DefaultConfigPath is <user config dir>/perigee/config.json:
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

	if err := cfg.validatePorts(); err != nil {
		return nil, err
	}

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
// rewriting anything. Used by -pair and -report, which must never touch the file.
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
		DisableLegacyToken: true,
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
	if c.WebPort == 0 {
		c.WebPort = 8765 // not 8081: that is where the Metro dev server lives
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

// validatePorts checks that the dashboard port is usable and doesn't clash with the phone port.
func (c *Config) validatePorts() error {
	if c.WebPort < 1024 || c.WebPort > 65535 {
		return fmt.Errorf("web_port %d is not valid: use a number between 1024 and 65535", c.WebPort)
	}
	if c.WebPort == c.Port {
		return fmt.Errorf("web_port %d is the same as port: choose a different web_port", c.WebPort)
	}
	return nil
}

var errNotDir = errors.New("not a directory")

// resolveDir follows symlinks and checks that the result is a folder.
func resolveDir(abs string) (string, error) {
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", errNotDir
	}
	return real, nil
}

// normalizeRoots expands ~, resolves to absolute real paths, fills labels,
// and checks that every root exists and has a unique label. A folder that is
// switched off may be missing (an unplugged drive, say).
func (c *Config) normalizeRoots() error {
	if len(c.Roots) == 0 {
		return errors.New(`no roots configured and no standard folders were found - add at least one folder to "roots" in the config file`)
	}

	seen := map[string]bool{}
	for i := range c.Roots {
		r := &c.Roots[i]

		abs, err := filepath.Abs(expandTilde(r.Path))
		if err != nil {
			return fmt.Errorf("root %q: %w", r.Path, err)
		}
		real, err := resolveDir(abs)
		if err != nil {
			if !r.Disabled {
				if errors.Is(err, errNotDir) {
					return fmt.Errorf("root %q is not a directory", r.Path)
				}
				return fmt.Errorf("root %q: %w", r.Path, err)
			}
			real = abs
		}
		r.Path = real

		if err := finishLabel(r, seen); err != nil {
			return err
		}
	}
	return nil
}

func finishLabel(r *Root, seen map[string]bool) error {
	if r.Label == "" {
		r.Label = filepath.Base(r.Path)
	}
	if r.Label == "" || r.Label == "." || r.Label == string(filepath.Separator) || strings.ContainsAny(r.Label, `/\`) {
		return fmt.Errorf("root %q needs a simple \"label\" (no slashes)", r.Path)
	}
	key := strings.ToLower(r.Label)
	if seen[key] {
		return fmt.Errorf("duplicate root label %q - give each root a unique label", r.Label)
	}
	seen[key] = true
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

// saveConfig writes the settings through a temporary file, so a crash can't leave half a file.
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
	tmp := configPath + ".tmp"
	// 0600: the file contains the access token.
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, configPath)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}