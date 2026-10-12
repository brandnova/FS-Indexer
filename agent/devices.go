package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const maxPairedDevices = 20

var errTooManyDevices = errors.New("Too many phones are paired. Remove one first.")

// PairedDevice is one phone. Only a hash of its key is stored here, never the key itself.
type PairedDevice struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	TokenHash string `json:"token_hash"`
	CreatedAt int64  `json:"created_at"`
	LastSeen  int64  `json:"last_seen"`
	LastIP    string `json:"last_ip"`
}

type devicesFile struct {
	Devices []PairedDevice `json:"devices"`
}

// DeviceStore is the list of paired phones, kept in devices.json next to the settings file.
type DeviceStore struct {
	mu       sync.Mutex
	path     string
	devices  []PairedDevice
	lastSave time.Time
	dirty    bool // "last seen" changed since the last save
	now      func() time.Time
}

// readDevicesFile reads the list without keeping it open (a missing file is an empty list).
func readDevicesFile(path string) ([]PairedDevice, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var f devicesFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return f.Devices, nil
}

func OpenDevices(path string) (*DeviceStore, error) {
	list, err := readDevicesFile(path)
	if err != nil {
		return nil, err
	}
	return &DeviceStore{path: path, devices: list, now: time.Now}, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// saveLocked writes the list through a temporary file. The caller holds the lock.
func (s *DeviceStore) saveLocked() error {
	if dir := filepath.Dir(s.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(devicesFile{Devices: append([]PairedDevice{}, s.devices...)}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return err
	}
	s.lastSave = s.now()
	s.dirty = false
	return nil
}

// Add pairs a new phone and returns its key. This is the only time the key exists in
// readable form on the PC: it is handed to the phone and forgotten.
func (s *DeviceStore) Add(name string) (string, PairedDevice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.devices) >= maxPairedDevices {
		return "", PairedDevice{}, errTooManyDevices
	}
	token := randomHex(32)
	now := s.now().Unix()
	d := PairedDevice{ID: randomHex(6), Name: name, TokenHash: hashToken(token), CreatedAt: now, LastSeen: now}

	s.devices = append(s.devices, d)
	if err := s.saveLocked(); err != nil {
		s.devices = s.devices[:len(s.devices)-1]
		return "", PairedDevice{}, err
	}
	return token, d, nil
}

// Authenticate finds the phone a key belongs to, and notes when it was last seen.
func (s *DeviceStore) Authenticate(token, ip string) (PairedDevice, bool) {
	if token == "" {
		return PairedDevice{}, false
	}
	h := hashToken(token)

	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.devices {
		if subtle.ConstantTimeCompare([]byte(h), []byte(s.devices[i].TokenHash)) != 1 {
			continue
		}
		now := s.now()
		s.devices[i].LastSeen = now.Unix()
		s.devices[i].LastIP = ip
		s.dirty = true
		if now.Sub(s.lastSave) >= 10*time.Minute { // "last seen" is saved now and then, not on every request
			_ = s.saveLocked()
		}
		return s.devices[i], true
	}
	return PairedDevice{}, false
}

// Revoke removes a phone: its key stops working at once.
func (s *DeviceStore) Revoke(id string) (PairedDevice, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, d := range s.devices {
		if d.ID != id {
			continue
		}
		before := append([]PairedDevice(nil), s.devices...)
		s.devices = append(s.devices[:i], s.devices[i+1:]...)
		if err := s.saveLocked(); err != nil {
			s.devices = before
			return PairedDevice{}, true, err
		}
		return d, true, nil
	}
	return PairedDevice{}, false, nil
}

// List returns the phones, newest first.
func (s *DeviceStore) List() []PairedDevice {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]PairedDevice, 0, len(s.devices))
	for i := len(s.devices) - 1; i >= 0; i-- {
		out = append(out, s.devices[i])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

func (s *DeviceStore) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.devices)
}

// Flush saves "last seen" times that haven't been written yet (called when the agent stops).
func (s *DeviceStore) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	return s.saveLocked()
}