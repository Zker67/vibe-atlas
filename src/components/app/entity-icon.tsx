import { useSyncExternalStore } from "react";
import { Boxes, Building2, FolderKanban, User, type LucideIcon } from "lucide-react";
import { Atlas } from "@/mygo";
import { parseIcon, projectIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

// Where the pages load the pictures of the images folder from; known
// after one call, the same for the app's life.
let base = "";
const listeners = new Set<() => void>();
void Atlas.imageBase().then(
  (b) => {
    base = b;
    for (const l of listeners) l();
  },
  () => {},
);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useImageBase = () => useSyncExternalStore(subscribe, () => base);

interface EntityIconProps {
  /** The icon, as Go keeps it: "" for fallback. */
  icon: string;
  fallback: LucideIcon;
  /** Sizes the icon (size-4 when not given) and colours a built-in one. */
  className?: string;
}

/**
 * The icon of a project or module, sized like a lucide icon by className:
 * a built-in icon, an emoji drawn to the same box, or a picture.
 */
export function EntityIcon({ icon, fallback: Fallback, className }: EntityIconProps) {
  const parsed = parseIcon(icon);
  const imageBase = useImageBase();
  const box = cn("size-4 shrink-0", className);
  switch (parsed.kind) {
    case "lucide":
      return <parsed.icon className={box} aria-hidden />;
    case "emoji":
      return (
        <svg viewBox="0 0 24 24" className={box} aria-hidden>
          <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="19">
            {parsed.emoji}
          </text>
        </svg>
      );
    case "image":
      if (imageBase) {
        return <img src={imageBase + parsed.name} alt="" draggable={false} className={cn(box, "rounded-[22%] object-contain")} />;
      }
  }
  return <Fallback className={box} aria-hidden />;
}

/** A project's icon: the one chosen, else its own found in its folder, else the folder icon. */
export function ProjectIcon({ project, className }: { project: { icon: string; detectedIcon: string }; className?: string }) {
  return <EntityIcon icon={projectIcon(project)} fallback={FolderKanban} className={className} />;
}

/** A module's icon, or the default one. */
export function ModuleIcon({ module, className }: { module: { icon: string }; className?: string }) {
  return <EntityIcon icon={module.icon} fallback={Boxes} className={className} />;
}

/** The default icon of an organization: a person for 个人, a building for the others. */
export const orgFallback = (personal: boolean): LucideIcon => (personal ? User : Building2);

/** An organization's icon, or its default one. */
export function OrgIcon({ org, className }: { org: { icon: string; personal: boolean }; className?: string }) {
  return <EntityIcon icon={org.icon} fallback={orgFallback(org.personal)} className={className} />;
}
