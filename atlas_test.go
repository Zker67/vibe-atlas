package main

import (
	"errors"
	"path/filepath"
	"strconv"
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

func TestItemTextListsChildren(t *testing.T) {
	db := openStore(t)
	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	add := func(title string, parent int64) store.Item {
		it, err := db.CreateItem(store.NewItem{ProjectID: p.ID, ParentID: parent, Title: title})
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	x := add("武器手感", 0)
	if _, err := db.SetItemNote(x.ID, "整体再顺一点"); err != nil {
		t.Fatal(err)
	}
	a := add("切枪卡一帧", x.ID)
	if _, err := db.SetItemNote(a.ID, "从步枪切到手枪时\r\n\r\n```\nswitch()\n```"); err != nil {
		t.Fatal(err)
	}
	add("换弹动画", a.ID)
	b := add("后坐力", x.ID)
	if _, err := db.SetItemStatus(b.ID, store.StatusDone); err != nil {
		t.Fatal(err)
	}
	x, _ = db.Item(x.ID)
	desc, err := db.Descendants(x.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := "武器手感\n\n整体再顺一点\n\n- [ ] 切枪卡一帧\n\n  从步枪切到手枪时\n\n  ```\n  switch()\n  ```\n\n  - [ ] 换弹动画\n- [x] 后坐力"
	if got := ItemText(x, desc); got != want {
		t.Fatalf("ItemText =\n%s\nwant\n%s", got, want)
	}
	if got := ItemText(b, nil); got != "后坐力" {
		t.Fatalf("ItemText of a leaf = %q", got)
	}
}

func TestItemsTextJoinsInOrder(t *testing.T) {
	db := openStore(t)
	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	add := func(title string, parent int64) store.Item {
		it, err := db.CreateItem(store.NewItem{ProjectID: p.ID, ParentID: parent, Title: title})
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	x := add("武器手感", 0)
	a := add("切枪卡一帧", x.ID)
	y := add("地图边界", 0)
	if _, err := db.SetItemNote(y.ID, "穿墙"); err != nil {
		t.Fatal(err)
	}

	// a sits under x: it shows in x's list only. The order is the one asked.
	got, err := ItemsText(db, []int64{y.ID, x.ID, a.ID, y.ID})
	if err != nil {
		t.Fatal(err)
	}
	want := "地图边界\n\n穿墙\n\n---\n\n武器手感\n\n- [ ] 切枪卡一帧"
	if got != want {
		t.Fatalf("ItemsText =\n%s\nwant\n%s", got, want)
	}
	if got, _ := ItemsText(db, []int64{a.ID}); got != "切枪卡一帧" {
		t.Fatalf("ItemsText of one = %q", got)
	}
	if _, err := ItemsText(db, []int64{x.ID, 9999}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing item: %v", err)
	}
}

func TestShareLinksOnByDefault(t *testing.T) {
	db := openStore(t)
	if !shareLinks(db) {
		t.Fatal("sub-items do not share links in a new database")
	}
	if err := setShareLinks(db, false); err != nil {
		t.Fatal(err)
	}
	if shareLinks(db) {
		t.Fatal("sharing links still on after turning it off")
	}
	if err := setShareLinks(db, true); err != nil {
		t.Fatal(err)
	}
	if !shareLinks(db) {
		t.Fatal("sharing links still off after turning it on")
	}
}

func TestItemLinkComesFromAbove(t *testing.T) {
	db := openStore(t)
	p, err := db.CreateProject("规则恐怖")
	if err != nil {
		t.Fatal(err)
	}
	add := func(title string, parent int64, link string) store.Item {
		it, err := db.CreateItem(store.NewItem{ProjectID: p.ID, ParentID: parent, Title: title, Deeplink: link})
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	top := add("武器手感", 0, "https://claude.ai/chat/top")
	mid := add("切枪", top.ID, "")
	leaf := add("换弹动画", mid.ID, "")
	own := add("后坐力", top.ID, "https://claude.ai/chat/own")
	alone := add("音效", 0, "")
	cases := []struct {
		name   string
		it     store.Item
		shared bool
		want   string
	}{
		{"from the parent", mid, true, "https://claude.ai/chat/top"},
		{"from two levels up", leaf, true, "https://claude.ai/chat/top"},
		{"its own first", own, true, "https://claude.ai/chat/own"},
		{"none anywhere", alone, true, ""},
		{"not shared", leaf, false, ""},
		{"not shared, its own", own, false, "https://claude.ai/chat/own"},
	}
	for _, c := range cases {
		got, err := itemLink(db, c.it, c.shared)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: itemLink = %q, want %q", c.name, got, c.want)
		}
	}
	// A parent does not take its children's links.
	if got, _ := itemLink(db, top, true); got != "https://claude.ai/chat/top" {
		t.Errorf("parent link = %q", got)
	}
}

func TestCaptureStartsInTheCurrentOrg(t *testing.T) {
	db := openStore(t)
	a := &Atlas{}
	a.setStore(db)
	must := func(p store.Project, err error) store.Project {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	want := func(org, project int64) {
		t.Helper()
		if got := a.captureState(); got.OrgID != org || got.ProjectID != project {
			t.Fatalf("capture state = %+v, want org %d, project %d", got, org, project)
		}
	}
	mine := must(db.CreateProject("规则恐怖"))
	work, err := db.CreateOrg(store.OrgDraft{Name: "IndieArk"})
	if err != nil {
		t.Fatal(err)
	}
	site := must(db.AddProject(store.ProjectDraft{Name: "官网", OrgID: work.ID}, ""))
	admin := must(db.AddProject(store.ProjectDraft{Name: "后台", OrgID: work.ID}, ""))
	want(store.PersonalOrg, mine.ID)

	// The project open is in another organization: the first of this one.
	if err := a.SetCurrentProject(mine.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.SetCurrentOrg(work.ID); err != nil {
		t.Fatal(err)
	}
	if got := a.currentOrg(db); got != work.ID {
		t.Fatalf("current org = %d", got)
	}
	want(work.ID, site.ID)
	if err := db.SetSetting(keyLastCapture, strconv.FormatInt(admin.ID, 10)); err != nil {
		t.Fatal(err)
	}
	want(work.ID, admin.ID)
	if err := a.SetCurrentProject(site.ID); err != nil {
		t.Fatal(err)
	}
	want(work.ID, site.ID)

	// An organization without projects, then gone: back to 个人.
	empty, err := db.CreateOrg(store.OrgDraft{Name: "空的"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SetCurrentOrg(empty.ID); err != nil {
		t.Fatal(err)
	}
	want(empty.ID, 0)
	if _, err := db.DeleteOrg(empty.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.SetCurrentProject(mine.ID); err != nil {
		t.Fatal(err)
	}
	want(store.PersonalOrg, mine.ID)
}
