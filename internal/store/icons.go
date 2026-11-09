package store

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// The icon of a project or module is one of:
//
//   - "": the default (for a project, 自动: the icon found in its folder)
//   - "lucide:<Name>": a built-in icon, by its name in lucide-react
//   - "emoji:<emoji>": an emoji
//   - "image:<name>": a picture of the images folder, as notes refer to
var (
	lucideIcon = regexp.MustCompile(`^lucide:[A-Z][A-Za-z0-9]{0,39}$`)
	imageIcon  = regexp.MustCompile(`^image:[0-9a-f]{16}\.(png|jpg|webp|gif|bmp)$`)
)

// maxEmojiRunes is the most code points an emoji icon may have: families
// and flags with their joiners and modifiers fit.
const maxEmojiRunes = 12

// checkIcon checks an icon the user chose.
func checkIcon(icon string) error {
	switch {
	case icon == "", lucideIcon.MatchString(icon), imageIcon.MatchString(icon):
		return nil
	case strings.HasPrefix(icon, "emoji:"):
		e := strings.TrimPrefix(icon, "emoji:")
		if e != "" && utf8.RuneCountInString(e) <= maxEmojiRunes && strings.TrimSpace(e) == e {
			return nil
		}
	}
	return userErr("图标不对")
}

// checkDetected checks an icon found in a project's folder: a picture, or
// none.
func checkDetected(icon string) error {
	if icon == "" || imageIcon.MatchString(icon) {
		return nil
	}
	return userErr("图标不对")
}
