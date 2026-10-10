package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// friendlyError is a problem explained in plain words, with a way out.
type friendlyError struct {
	Title  string
	Detail string
	Hint   string
}

// fail shows a problem and exits.
func fail(c *Console, f friendlyError) {
	c.Problem(f.Title, f.Detail, f.Hint)
	os.Exit(1)
}

// explainConfigError turns a settings-file error into something a person can act on.
func explainConfigError(path string, err error) friendlyError {
	msg := err.Error()

	switch {
	case strings.Contains(msg, "no roots configured"):
		return friendlyError{
			Title:  "There are no folders to share",
			Detail: "None of your standard folders (Documents, Downloads, Desktop, ...) were found, and none are listed in your settings.",
			Hint:   fmt.Sprintf(`open %s and add a folder, for example:  "roots": [ { "path": "/path/to/folder" } ]`, path),
		}
	case strings.Contains(msg, "duplicate root label"):
		return friendlyError{
			Title:  "Two folders have the same name",
			Detail: msg,
			Hint:   fmt.Sprintf(`give each folder in "roots" its own "label" in %s`, path),
		}
	case strings.Contains(msg, "needs a simple"):
		return friendlyError{
			Title:  "A folder needs a name",
			Detail: msg,
			Hint:   fmt.Sprintf(`add a "label" (a short name without slashes) to that folder in %s`, path),
		}
	case strings.Contains(msg, "is not a directory"):
		return friendlyError{
			Title:  "A path in your settings is a file, not a folder",
			Detail: msg,
			Hint:   fmt.Sprintf(`point "roots" in %s at a folder`, path),
		}
	case strings.Contains(msg, "allowed_networks"):
		return friendlyError{
			Title:  `A network in "allowed_networks" isn't valid`,
			Detail: msg,
			Hint:   fmt.Sprintf(`use the form 100.64.0.0/10 in %s, or remove the entry`, path),
		}
	case strings.Contains(msg, "does not exist yet"), strings.Contains(msg, "is incomplete"):
		return friendlyError{
			Title:  "There are no settings yet",
			Detail: msg,
			Hint:   "start the agent once, without -pair or -rotate-token, to create them",
		}
	case strings.HasPrefix(msg, "parse "):
		return friendlyError{
			Title:  "Your settings file has a mistake",
			Detail: msg,
			Hint:   fmt.Sprintf("fix the mistake in %s. Or delete the file to start fresh (a new one is created, with a new token, so phones must pair again)", path),
		}
	case errors.Is(err, fs.ErrNotExist):
		return friendlyError{
			Title:  "A folder in your settings doesn't exist",
			Detail: msg,
			Hint:   fmt.Sprintf(`check the path under "roots" in %s, or remove that folder from the list`, path),
		}
	case errors.Is(err, fs.ErrPermission):
		return friendlyError{
			Title:  "The agent isn't allowed to use its settings",
			Detail: msg,
			Hint:   fmt.Sprintf("make sure your account can read and write %s", path),
		}
	}

	return friendlyError{
		Title:  "The agent couldn't start",
		Detail: msg,
		Hint:   "if this keeps happening, please report it and include the message above",
	}
}

// explainListenError turns "can't open the port" into something a person can act on.
func explainListenError(addr string, err error) friendlyError {
	port := strings.TrimPrefix(addr, ":")
	low := strings.ToLower(err.Error())

	switch {
	case strings.Contains(low, "address already in use"), strings.Contains(low, "only one usage of each socket address"):
		return friendlyError{
			Title:  fmt.Sprintf("Port %s is already in use", port),
			Detail: "Another copy of the agent, or a different program, is already using it.",
			Hint:   `close the other copy, or choose another port by changing "port" in your settings file`,
		}
	case strings.Contains(low, "permission denied"), strings.Contains(low, "access permissions"):
		return friendlyError{
			Title:  fmt.Sprintf("The agent isn't allowed to use port %s", port),
			Detail: "Ports below 1024 usually need administrator rights.",
			Hint:   `use a higher port, such as 8080, in your settings file`,
		}
	}

	return friendlyError{
		Title:  "The agent couldn't start listening for the app",
		Detail: err.Error(),
		Hint:   "check that no firewall or security program is blocking it, then try again",
	}
}