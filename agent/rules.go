package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

// RuleGroup is a set of built-in rules, for the dashboard to list.
type RuleGroup struct {
	Source   string   `json:"source"`
	Note     string   `json:"note"`
	Patterns []string `json:"patterns"`
}

func builtinRuleGroups() []RuleGroup {
	return []RuleGroup{
		{Source: srcSecret, Note: "Always skipped. Names like these usually hold passwords or keys.", Patterns: append([]string(nil), secretIgnores...)},
		{Source: srcNoise, Note: "Always skipped. Build output and system leftovers nobody wants to search.", Patterns: append([]string(nil), noiseIgnores...)},
		{Source: srcSystem, Note: "Skipped on this kind of computer.", Patterns: append([]string(nil), presetIgnores()...)},
		{Source: srcHidden, Note: "Skipped unless you turn on \"Include hidden files\".", Patterns: []string{".*"}},
	}
}

// PathVerdict is the answer to "would this be shared?".
type PathVerdict struct {
	Shared bool   `json:"shared"`
	Reason string `json:"reason"`
	Rule   string `json:"rule,omitempty"`
	Source string `json:"source,omitempty"`
}

// explainPath says whether a path would be shared, and why not. The path can be
// the full path on this computer, or the way the phone shows it ("Documents/cv/me.pdf").
func explainPath(cfg *Config, input string) PathVerdict {
	input = strings.TrimSpace(input)
	if input == "" {
		return PathVerdict{Reason: "Type or paste a path to test."}
	}
	root, rel, ok := locate(cfg, input)
	if !ok {
		return PathVerdict{Reason: "That path isn't inside any of your shared folders."}
	}
	if root.Disabled {
		return PathVerdict{Reason: fmt.Sprintf("The folder \"%s\" is switched off, so nothing in it is shared.", root.Label)}
	}

	ig := ignorerFor(cfg, cfg.IncludeHidden || root.IncludeHidden)
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" {
			continue
		}
		if r, hit := ig.why(seg); hit {
			return PathVerdict{
				Reason: fmt.Sprintf("Skipped: \"%s\" matches a rule from \"%s\".", seg, r.source),
				Rule:   r.pattern,
				Source: r.source,
			}
		}
	}
	return PathVerdict{Shared: true, Reason: "This would be shared."}
}

// locate finds the shared folder a path belongs to, and the rest of the path below it.
func locate(cfg *Config, input string) (Root, string, bool) {
	if filepath.IsAbs(input) {
		clean := filepath.Clean(input)
		for _, r := range cfg.Roots {
			if pathsEqual(clean, r.Path) {
				return r, "", true
			}
			if pathInside(clean, r.Path) {
				rel, err := filepath.Rel(r.Path, clean)
				if err == nil {
					return r, filepath.ToSlash(rel), true
				}
			}
		}
		return Root{}, "", false
	}

	parts := strings.Split(strings.Trim(strings.ReplaceAll(input, `\`, "/"), "/"), "/")
	for _, r := range cfg.Roots {
		if strings.EqualFold(r.Label, parts[0]) {
			return r, strings.Join(parts[1:], "/"), true
		}
	}
	return Root{}, "", false
}