package main

import (
	"strings"
	"testing"
	"time"
)

func TestPairingCodeFormat(t *testing.T) {
	p := NewPairingCodes(time.Minute)
	code, _ := p.Current()

	if len(code) != pairingCodeLength {
		t.Fatalf("code %q should have %d characters", code, pairingCodeLength)
	}
	for _, r := range code {
		if !strings.ContainsRune(pairingCodeAlphabet, r) {
			t.Errorf("%q has the character %q, which isn't in the alphabet", code, r)
		}
	}
	if got := formatCode(code); len(got) != 11 || got[5] != '-' {
		t.Errorf("formatCode = %q", got)
	}
}

func TestPairingCodeWorksOnce(t *testing.T) {
	p := NewPairingCodes(time.Minute)
	code, _ := p.Current()

	if same, _ := p.Current(); same != code {
		t.Error("asking again should give the same code until it is used")
	}
	if !p.Redeem(code) {
		t.Fatal("the right code should work")
	}
	if p.Redeem(code) {
		t.Error("a code must not work twice")
	}
	if next, _ := p.Current(); next == code {
		t.Error("after use a new code should be made")
	}
}

func TestPairingCodeForgivesTyping(t *testing.T) {
	p := NewPairingCodes(time.Minute)
	p.code = "AB0DE1GHJK"
	p.expires = time.Now().Add(time.Minute)

	if !p.Redeem("ab-oDe-lGHJK") {
		t.Error("lower case, a dash and O/L for 0/1 should still work")
	}
}

func TestPairingCodeRejectsWrongOnes(t *testing.T) {
	p := NewPairingCodes(time.Minute)
	code, _ := p.Current()

	for _, wrong := range []string{"", "AAAAAAAAAA", code[:9], code + "X"} {
		if p.Redeem(wrong) {
			t.Errorf("%q should not work", wrong)
		}
	}
	if !p.Redeem(code) {
		t.Error("wrong guesses must not use up the real code")
	}
}

func TestPairingCodeExpiresAndRenews(t *testing.T) {
	p := NewPairingCodes(10 * time.Minute)
	clock := time.Now()
	p.now = func() time.Time { return clock }

	old, _ := p.Current()
	clock = clock.Add(11 * time.Minute)
	if p.Redeem(old) {
		t.Error("an expired code must not work")
	}
	fresh, _ := p.Current()
	if fresh == old {
		t.Error("an expired code should be replaced")
	}

	renewed, _ := p.Renew()
	if renewed == fresh || p.Redeem(fresh) {
		t.Error("renewing must cancel the previous code")
	}
}