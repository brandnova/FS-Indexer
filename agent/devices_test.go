package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDeviceStoreNeverKeepsTheKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	s, err := OpenDevices(path)
	if err != nil {
		t.Fatal(err)
	}
	token, dev, err := s.Add("Pixel 8")
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != 64 {
		t.Errorf("the key should be 64 hex characters, got %d", len(token))
	}

	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), token) {
		t.Error("the key itself must never be written to disk")
	}
	if !strings.Contains(string(data), hashToken(token)) {
		t.Error("its hash should be")
	}

	got, ok := s.Authenticate(token, "192.168.1.9")
	if !ok || got.ID != dev.ID || got.LastIP != "192.168.1.9" {
		t.Errorf("the right key should work: %+v %v", got, ok)
	}
	for _, bad := range []string{"", token + "x", token[:63]} {
		if _, ok := s.Authenticate(bad, "1.2.3.4"); ok {
			t.Errorf("%q must not work", bad)
		}
	}
}

func TestDeviceStorePersistsAndRevokes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	s, _ := OpenDevices(path)
	first, _, _ := s.Add("First")
	second, _, _ := s.Add("Second")

	reopened, err := OpenDevices(path)
	if err != nil {
		t.Fatal(err)
	}
	list := reopened.List()
	if len(list) != 2 || list[0].Name != "Second" || list[1].Name != "First" {
		t.Fatalf("expected the newest first, got %+v", list)
	}

	if _, found, err := reopened.Revoke(list[1].ID); !found || err != nil {
		t.Fatalf("revoke: %v %v", found, err)
	}
	if _, ok := reopened.Authenticate(first, "x"); ok {
		t.Error("a removed phone must lose access")
	}
	if _, ok := reopened.Authenticate(second, "x"); !ok {
		t.Error("the other phone must keep working")
	}
	if _, found, _ := reopened.Revoke("nope"); found {
		t.Error("an unknown phone can't be removed")
	}

	again, _ := OpenDevices(path)
	if again.Count() != 1 {
		t.Errorf("the removal should be saved, got %d phones", again.Count())
	}
}

func TestDeviceStoreLimitAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	s, _ := OpenDevices(path)
	for i := 0; i < maxPairedDevices; i++ {
		if _, _, err := s.Add(fmt.Sprintf("Phone %d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.Add("One too many"); err != errTooManyDevices {
		t.Errorf("expected the limit error, got %v", err)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(path); st.Mode().Perm() != 0o600 {
			t.Errorf("devices.json should be private, got %v", st.Mode().Perm())
		}
	}
}

func TestDeviceStoreRejectsADamagedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenDevices(path); err == nil || !strings.Contains(err.Error(), "parse") {
		t.Errorf("a damaged file should be reported, got %v", err)
	}
}

func TestDeviceStoreFlushSavesLastSeen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	s, _ := OpenDevices(path)
	token, _, _ := s.Add("Pixel")

	s.Authenticate(token, "10.0.0.7") // too soon after Add to be written by itself
	if err := s.Flush(); err != nil {
		t.Fatal(err)
	}
	again, _ := OpenDevices(path)
	if got := again.List(); len(got) != 1 || got[0].LastIP != "10.0.0.7" {
		t.Errorf("the last-seen address should be saved: %+v", got)
	}
}