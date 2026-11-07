package main

import (
	"path/filepath"
	"testing"

	"github.com/Zker67/vibe-atlas/internal/store"
)

// openStore opens a store in a fresh database file, as the app does.
func openStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "atlas.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestEffectsOffByDefault(t *testing.T) {
	db := openStore(t)
	if effectsOn(db) {
		t.Error("effects are on in a new database")
	}
	if got := background(db); got != BackgroundGrid {
		t.Errorf("background = %q, want %q", got, BackgroundGrid)
	}
}

func TestEffectsPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "atlas.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := setEffects(db, true); err != nil {
		t.Fatal(err)
	}
	if err := setBackground(db, BackgroundWaves); err != nil {
		t.Fatal(err)
	}
	db.Close()

	db, err = store.Open(path) // what the next start reads
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if !effectsOn(db) || background(db) != BackgroundWaves {
		t.Fatalf("after reopening: effects %v, background %q", effectsOn(db), background(db))
	}
	if err := setEffects(db, false); err != nil {
		t.Fatal(err)
	}
	if effectsOn(db) {
		t.Error("effects stay on after turning them off")
	}
}

func TestBackgroundRejectsUnknown(t *testing.T) {
	db := openStore(t)
	if err := setBackground(db, "aurora"); err == nil {
		t.Fatal("an unknown background was accepted")
	}
	if got := background(db); got != BackgroundGrid {
		t.Errorf("background = %q after a rejected change", got)
	}
	// A value written by a later version falls back to the default.
	if err := db.SetSetting(keyBackground, "aurora"); err != nil {
		t.Fatal(err)
	}
	if got := background(db); got != BackgroundGrid {
		t.Errorf("background = %q for an unknown stored value", got)
	}
}
