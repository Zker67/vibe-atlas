package store

import (
	"fmt"
	"testing"
	"time"
)

// TestHundredsOfItemsStayQuick fills a project the way months of use would,
// then times what the pages read on every change. The bound is loose: it
// catches a query that went quadratic, not a slow disk.
func TestHundredsOfItemsStayQuick(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	var modules []int64
	for i := range 8 {
		modules = append(modules, must(s.CreateModule(p.ID, fmt.Sprintf("模块 %d", i+1))).ID)
	}
	types := []ItemType{TypeImprove, TypeBug, TypeFeature}
	const n = 600
	for i := range n {
		moduleID := int64(0)
		if i%9 != 0 {
			moduleID = modules[i%len(modules)]
		}
		it := must(s.CreateItem(NewItem{ProjectID: p.ID, ModuleID: moduleID, Type: types[i%3], Title: fmt.Sprintf("改进点 %d", i+1)}))
		switch {
		case i%3 == 0:
			must(s.SetItemStatus(it.ID, StatusDone))
		case i%17 == 0:
			must(s.SetItemStatus(it.ID, StatusDoing))
		}
	}

	timed := func(what string, read func() error) {
		t.Helper()
		start := time.Now()
		if err := read(); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		took := time.Since(start)
		t.Logf("%s: %v", what, took)
		if took > time.Second {
			t.Fatalf("%s took %v with %d items", what, took, n)
		}
	}
	timed("Projects", func() error { _, err := s.Projects(); return err })
	timed("Modules", func() error { _, err := s.Modules(p.ID); return err })
	timed("Items", func() error {
		items, err := s.Items(p.ID)
		if err == nil && len(items) != n {
			err = fmt.Errorf("got %d items, want %d", len(items), n)
		}
		return err
	})
	timed("Overview", func() error {
		o, err := s.Overview(p.ID)
		if err == nil && o.Totals.Todo+o.Totals.Doing+o.Totals.Done != n {
			err = fmt.Errorf("overview counts %+v, want %d in all", o.Totals, n)
		}
		return err
	})
}
