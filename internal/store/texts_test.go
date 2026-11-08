package store

import (
	"slices"
	"testing"
)

func TestTextsWithFindsNotesAndDescriptions(t *testing.T) {
	s, _ := newStore(t)
	p := must(s.CreateProject("规则恐怖"))
	must(s.SetProjectDescription(p.ID, "封面 ![](image:aaaaaaaaaaaaaaaa.png)"))
	other := must(s.CreateProject("别的项目"))
	must(s.SetProjectDescription(other.ID, "没有图片"))
	a := must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "有图"}))
	must(s.SetItemNote(a.ID, "![](image:bbbbbbbbbbbbbbbb.jpg)"))
	b := must(s.CreateItem(NewItem{ProjectID: other.ID, ParentID: 0, Title: "子项目里的图"}))
	c := must(s.CreateItem(NewItem{ProjectID: other.ID, ParentID: b.ID, Title: "子改进点"}))
	must(s.SetItemNote(c.ID, "截图：![](image:cccccccccccccccc.webp)"))
	must(s.CreateItem(NewItem{ProjectID: p.ID, Title: "没图", Note: "image 这个词"}))

	got := must(s.TextsWith("image:"))
	slices.Sort(got)
	want := []string{
		"![](image:bbbbbbbbbbbbbbbb.jpg)",
		"封面 ![](image:aaaaaaaaaaaaaaaa.png)",
		"截图：![](image:cccccccccccccccc.webp)",
	}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("TextsWith = %q, want %q", got, want)
	}

	if err := s.DeleteItem(a.ID); err != nil {
		t.Fatal(err)
	}
	if got := must(s.TextsWith("bbbbbbbbbbbbbbbb")); len(got) != 0 {
		t.Errorf("a deleted item's note is still found: %q", got)
	}
}
