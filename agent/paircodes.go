package main

import (
	"crypto/rand"
	"crypto/subtle"
	"strings"
	"sync"
	"time"
)

const (
	pairingCodeLength   = 10
	pairingCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" // no I, L, O or U: nothing to mix up when typing
	pairingCodeTTL      = 10 * time.Minute
)

// PairingCodes holds the one code that is currently valid. A code works once, then
// it is gone. It also stops working after a few minutes. A code is only ever kept
// in memory: restarting the agent invalidates it.
type PairingCodes struct {
	mu      sync.Mutex
	code    string
	expires time.Time
	ttl     time.Duration
	now     func() time.Time
}

func NewPairingCodes(ttl time.Duration) *PairingCodes {
	return &PairingCodes{ttl: ttl, now: time.Now}
}

func newPairingCode() string {
	b := make([]byte, pairingCodeLength)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = pairingCodeAlphabet[int(b[i])%len(pairingCodeAlphabet)] // 256 is a multiple of 32: no bias
	}
	return string(b)
}

// Current returns the valid code, making a new one if there is none, it was used, or it ran out.
func (p *PairingCodes) Current() (string, time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.code == "" || !p.now().Before(p.expires) {
		p.code = newPairingCode()
		p.expires = p.now().Add(p.ttl)
	}
	return p.code, p.expires
}

// Renew always makes a new code, which cancels the old one.
func (p *PairingCodes) Renew() (string, time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.code = newPairingCode()
	p.expires = p.now().Add(p.ttl)
	return p.code, p.expires
}

// Redeem checks a code typed or scanned on a phone. A right code is used up.
func (p *PairingCodes) Redeem(input string) bool {
	given := normalizeCode(input)

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.code == "" || !p.now().Before(p.expires) {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(given), []byte(p.code)) != 1 {
		return false
	}
	p.code = "" // single use
	return true
}

// normalizeCode forgives how people type codes: case, spaces, dashes, and O/I/L for 0/1/1.
func normalizeCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		switch r {
		case ' ', '-', '\t', '\n', '\r':
			continue
		case 'O':
			r = '0'
		case 'I', 'L':
			r = '1'
		}
		b.WriteRune(r)
	}
	return b.String()
}

// formatCode shows a code the way people read it: ABCDE-FGHJK.
func formatCode(code string) string {
	if len(code) == pairingCodeLength {
		return code[:5] + "-" + code[5:]
	}
	return code
}