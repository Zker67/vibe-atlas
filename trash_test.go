package main

import (
	"testing"
	"time"

	"github.com/Zker67/vibe-atlas/internal/store"
)

func TestTrashDays(t *testing.T) {
	db := openStore(t)
	if got := trashDays(db); got != defaultTrashDays {
		t.Fatalf("trashDays of a new database = %d, want %d", got, defaultTrashDays)
	}
	for v, want := range map[string]int{"0": 0, "7": 7, "90": 90} {
		if err := db.SetSetting(keyTrashDays, v); err != nil {
			t.Fatal(err)
		}
		if got := trashDays(db); got != want {
			t.Fatalf("trashDays after %q = %d, want %d", v, got, want)
		}
	}
	for _, v := range []string{"5", "-1", "abc", ""} {
		if err := db.SetSetting(keyTrashDays, v); err != nil {
			t.Fatal(err)
		}
		if got := trashDays(db); got != defaultTrashDays {
			t.Fatalf("trashDays after %q = %d, want the default", v, got)
		}
	}
}

// TestCleanImagesKeepsThoseOfTheTrash: a picture only a note in the trash
// shows stays, so restoring the item brings it back whole; deleted for
// good, it goes with the next cleanup.
func TestCleanImagesKeepsThoseOfTheTrash(t *testing.T) {
	db := openStore(t)
	dataDir := t.TempDir()
	name, err := saveImage(dataDir, pngBytes(t, 77))
	if err != nil {
		t.Fatal(err)
	}
	age(t, dataDir, name, 48*time.Hour)
	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	it, err := db.CreateItem(store.NewItem{ProjectID: p.ID, Title: "界面", Note: "![](image:" + name + ")"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.TrashItems([]int64{it.ID}); err != nil {
		t.Fatal(err)
	}
	if n, err := cleanImages(db, dataDir, imageGrace); err != nil || n != 0 {
		t.Fatalf("cleanImages = %d, %v; want the picture of the trash kept", n, err)
	}
	if _, err := db.EmptyTrash(); err != nil {
		t.Fatal(err)
	}
	if n, err := cleanImages(db, dataDir, imageGrace); err != nil || n != 1 {
		t.Fatalf("cleanImages after emptying the trash = %d, %v; want 1", n, err)
	}
}
