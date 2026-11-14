import { useMemo } from "react";
import { Check, ChevronsUpDown, Plus, SquarePen, Trash2 } from "lucide-react";
import type { Org } from "@/mygo";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteOrg, switchOrg, useAtlas } from "@/state/atlas";
import { askConfirm, askOrg } from "@/state/dialogs";
import { useSidebar } from "@/state/sidebar";
import { OrgIcon } from "./entity-icon";

function confirmDeleteOrg(org: Org) {
  const { projects, orgs } = useAtlas.getState();
  const total = projects.filter((p) => p.orgId === org.id).length;
  const personal = orgs.find((o) => o.personal)?.name ?? "个人";
  askConfirm({
    title: `删除组织「${org.name}」？`,
    description: total > 0 ? `它的 ${total} 个项目会移到「${personal}」，项目里的模块和改进点都不会删除。` : "它还没有项目。",
    confirmText: "删除",
    destructive: true,
    onConfirm: () => deleteOrg(org.id),
  });
}

/** An organization's icon on a tile. */
function OrgTile({ org }: { org: Org }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground/[0.07] ring-1 ring-foreground/10">
      <OrgIcon org={org} className="size-4 text-foreground/80" />
    </span>
  );
}

/**
 * The organization open, in the title bar over the sidebar: its icon and
 * name, which open the list of organizations to switch to, add, edit or
 * delete one. Over the rail of icons, the icon alone.
 */
export function OrgSwitcher() {
  const orgs = useAtlas((s) => s.orgs);
  const orgId = useAtlas((s) => s.orgId);
  const projects = useAtlas((s) => s.projects);
  const collapsed = useSidebar((s) => s.collapsed);
  const counts = useMemo(() => {
    const n = new Map<number, number>();
    for (const p of projects) n.set(p.orgId, (n.get(p.orgId) ?? 0) + 1);
    return n;
  }, [projects]);
  const org = orgs.find((o) => o.id === orgId);
  if (!org) return null;

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-org-switcher=""
        aria-label={collapsed ? `切换组织，当前是「${org.name}」` : undefined}
        className={cn(
          "flex h-8 min-w-0 items-center gap-2 rounded-md transition-colors duration-150 hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-sidebar-accent",
          collapsed ? "size-8 justify-center" : "-ml-1 pr-1.5 pl-1",
        )}
      >
        <OrgTile org={org} />
        {!collapsed && (
          <>
            <span className="truncate font-semibold tracking-tight">{org.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{org.name}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换组织</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} aria-current={o.id === orgId || undefined} onSelect={() => switchOrg(o.id)}>
            <OrgIcon org={o} />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="meta-mono text-xs text-muted-foreground">{counts.get(o.id) ?? 0}</span>
            <Check className={cn(o.id !== orgId && "invisible")} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => askOrg()}>
          <Plus />
          新建组织
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => askOrg(org)}>
          <SquarePen />
          编辑组织
        </DropdownMenuItem>
        {!org.personal && (
          <DropdownMenuItem variant="destructive" onSelect={() => confirmDeleteOrg(org)}>
            <Trash2 />
            删除组织
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
