package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"testing"
)

func TestIndexGzip(t *testing.T) {
	ts, _ := newTestServer(t)

	// DisableCompression: we set Accept-Encoding ourselves and look at the raw bytes.
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}

	get := func(acceptGzip bool) *http.Response {
		req, err := http.NewRequest("GET", ts.URL+"/api/v1/index", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+testToken)
		if acceptGzip {
			req.Header.Set("Accept-Encoding", "gzip")
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		return resp
	}

	plain := get(false)
	if enc := plain.Header.Get("Content-Encoding"); enc != "" {
		t.Errorf("a client that didn't ask must get plain data, got Content-Encoding %q", enc)
	}
	plainBody, err := io.ReadAll(plain.Body)
	if err != nil {
		t.Fatal(err)
	}

	zipped := get(true)
	if enc := zipped.Header.Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", enc)
	}
	if got := zipped.Header.Get("X-File-Count"); got != "2" {
		t.Errorf("X-File-Count = %q, want 2", got)
	}

	zr, err := gzip.NewReader(zipped.Body)
	if err != nil {
		t.Fatal(err)
	}
	zippedBody, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(plainBody, zippedBody) {
		t.Error("the decompressed body differs from the plain one")
	}
}