package store

// ModuleStats counts the items of a module.
type ModuleStats struct {
	// ModuleID is 0 for the items without a module (「未分类」).
	ModuleID int64  `json:"moduleId"`
	Name     string `json:"name"`
	Counts   Counts `json:"counts"`
}

// TypeStats counts the items of a kind.
type TypeStats struct {
	Type   ItemType `json:"type"`
	Counts Counts   `json:"counts"`
}

// Overview sums up a project from its items.
type Overview struct {
	ProjectID int64 `json:"projectId"`
	// Totals counts every item of the project.
	Totals Counts `json:"totals"`
	// Modules counts the items of each module, in the user's order, then
	// those without a module when there are any.
	Modules []ModuleStats `json:"modules"`
	// Types counts the items of each kind: improve, bug, feature.
	Types []TypeStats `json:"types"`
	// Doing lists the doing items, in the order they were started.
	Doing []Item `json:"doing"`
	// Done lists the done items, the most recently done first.
	Done []Item `json:"done"`
	// Ready lists the items to do that have prerequisites, all done: those
	// that waited and may start now, in the order of the items to do.
	Ready []Item `json:"ready"`
}

func (c *Counts) add(status ItemStatus) {
	switch status {
	case StatusTodo:
		c.Todo++
	case StatusDoing:
		c.Doing++
	case StatusDone:
		c.Done++
	}
}

// Overview sums up a project.
func (s *Store) Overview(projectID int64) (Overview, error) {
	if _, err := s.Project(projectID); err != nil {
		return Overview{}, err
	}
	modules, err := s.Modules(projectID)
	if err != nil {
		return Overview{}, err
	}
	items, err := s.Items(projectID)
	if err != nil {
		return Overview{}, err
	}
	deps, err := s.Deps(projectID)
	if err != nil {
		return Overview{}, err
	}
	o := Overview{
		ProjectID: projectID,
		Modules:   make([]ModuleStats, 0, len(modules)+1),
		Types:     []TypeStats{{Type: TypeImprove}, {Type: TypeBug}, {Type: TypeFeature}},
		Doing:     []Item{},
		Done:      []Item{},
		Ready:     []Item{},
	}
	status := make(map[int64]ItemStatus, len(items))
	for _, it := range items {
		status[it.ID] = it.Status
	}
	// For each item, whether it has prerequisites, and whether all are done.
	hasDeps := map[int64]bool{}
	waiting := map[int64]bool{}
	for _, d := range deps {
		hasDeps[d.ToID] = true
		if status[d.FromID] != StatusDone {
			waiting[d.ToID] = true
		}
	}
	byModule := make(map[int64]int, len(modules))
	for _, m := range modules {
		byModule[m.ID] = len(o.Modules)
		o.Modules = append(o.Modules, ModuleStats{ModuleID: m.ID, Name: m.Name})
	}
	var unsorted Counts
	for _, it := range items {
		o.Totals.add(it.Status)
		if i, ok := byModule[it.ModuleID]; ok {
			o.Modules[i].Counts.add(it.Status)
		} else {
			unsorted.add(it.Status)
		}
		for i := range o.Types {
			if o.Types[i].Type == it.Type {
				o.Types[i].Counts.add(it.Status)
			}
		}
		switch it.Status {
		case StatusDoing:
			o.Doing = append(o.Doing, it)
		case StatusDone:
			o.Done = append(o.Done, it)
		case StatusTodo:
			if hasDeps[it.ID] && !waiting[it.ID] {
				o.Ready = append(o.Ready, it)
			}
		}
	}
	if unsorted != (Counts{}) {
		o.Modules = append(o.Modules, ModuleStats{Name: "未分类", Counts: unsorted})
	}
	return o, nil
}
