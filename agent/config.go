package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Root is one folder to index. Label becomes the first segment of every
// path under it (e.g. "Documents/cv/resume.pdf").
type Root struct {
	Path  string `json:"path"`
	Label string `json:"label,omitempty"`
}

type Config struct {
	DeviceID     string   `json:"device_id"`
	DeviceName   string   `json:"device_name"`
	Port         int      `json:"port"`
	Token        string   `json:"token"`
	Roots        []Root   `json:"roots"`
	ExtraIgnores []string `json:"extra_ignores"`
}

// LoadConfig reads config.json. If the file doesn't exist it is created with
// safe defaults, and any missing id/token is generated and saved back, so the
// agent runs with zero manual setup.
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
	if created || changed {
		if err := saveConfig(configPath, cfg); err != nil {
			return nil, err
		}
		if created {
			fmt.Fprintf(os.Stderr, "Created %s - edit it to choose which folders to index.\n", configPath)
		}
	}

	if err := cfg.normalizeRoots(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func defaultConfig() *Config {
	cfg := &Config{ExtraIgnores: []string{}}
	if home, err := os.UserHomeDir(); err == nil {
		docs := filepath.Join(home, "Documents")
		if st, err := os.Stat(docs); err == nil && st.IsDir() {
			cfg.Roots = []Root{{Path: "~/Documents", Label: "Documents"}}
		}
	}
	if cfg.Roots == nil {
		cfg.Roots = []Root{}
	}
	return cfg
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
	return changed
}

// normalizeRoots expands ~, resolves to absolute real paths, fills labels,
// and checks that every root exists and has a unique label.
func (c *Config) normalizeRoots() error {
	if len(c.Roots) == 0 {
		return errors.New(`no roots configured - add at least one folder to "roots" in config.json`)
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

func saveConfig(configPath string, cfg *Config) error {
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