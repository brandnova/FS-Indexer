package main

import (
	"fmt"
	"sync"
	"time"
)

// Event is one line in the dashboard's activity feed.
type Event struct {
	Time int64  `json:"time"` // unix seconds
	Text string `json:"text"`
}

// EventLog keeps the most recent events in memory, for the dashboard.
type EventLog struct {
	mu     sync.Mutex
	max    int
	events []Event
}

func NewEventLog(max int) *EventLog {
	return &EventLog{max: max}
}

// Addf records an event.
func (l *EventLog) Addf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.events = append(l.events, Event{Time: time.Now().Unix(), Text: fmt.Sprintf(format, args...)})
	if len(l.events) > l.max {
		l.events = l.events[len(l.events)-l.max:]
	}
}

// Recent returns the events, newest first.
func (l *EventLog) Recent() []Event {
	l.mu.Lock()
	defer l.mu.Unlock()

	out := make([]Event, len(l.events))
	for i, e := range l.events {
		out[len(l.events)-1-i] = e
	}
	return out
}