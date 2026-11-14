package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImageFilesOf(t *testing.T) {
	dir := t.TempDir()
	pic := filepath.Join(dir, "shot.png")
	text := filepath.Join(dir, "notes.png")
	big := filepath.Join(dir, "big.png")
	for path, data := range map[string][]byte{
		pic:  pngBytes(t, 5),
		text: []byte("not a picture"),
		big:  append(pngBytes(t, 6), make([]byte, maxImageBytes)...),
	} {
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got := imageFilesOf([]string{text, pic, filepath.Join(dir, "none.png"), big, dir})
	if len(got) != 1 || got[0].Type != "image/png" || len(got[0].Data) != len(pngBytes(t, 5)) {
		t.Fatalf("got %d pictures, want only shot.png", len(got))
	}
	if got := imageFilesOf(nil); got == nil || len(got) != 0 {
		t.Errorf("no files: %v, want an empty list", got)
	}
}
