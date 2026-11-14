import { useState } from "react";
import { Boxes, FolderKanban, FolderOpen, FolderPlus, Info, LoaderCircle, Pencil, Wand, X } from "lucide-react";
import { Atlas } from "@/mygo";
import { errorMessage, run } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addProject, createModule, createOrg, detectProjectIcon, editOrg, editProject, renameModule, setModuleIcon } from "@/state/atlas";
import { useDialogs, type ModuleRequest, type OrgRequest, type ProjectRequest } from "@/state/dialogs";
import { EntityIcon, orgFallback } from "./entity-icon";
import { IconPopover } from "./icon-picker";

const closeProject = () => useDialogs.setState({ project: null });
const closeModule = () => useDialogs.setState({ module: null });
const closeOrg = () => useDialogs.setState({ org: null });

/** The dialog that adds a project, or edits its icon, name and folder. */
export function ProjectDialog() {
  const request = useDialogs((s) => s.project);
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && closeProject()}>
      <DialogContent className="sm:max-w-md">
        {/* Each request starts the form over. */}
        {request && <ProjectForm key={request.project?.id ?? "new"} request={request} />}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ request }: { request: ProjectRequest }) {
  const editing = request.project;
  const [name, setName] = useState(editing?.name ?? "");
  const [folder, setFolder] = useState(editing?.folderPath ?? "");
  const [folderExists, setFolderExists] = useState(editing ? editing.folderExists : true);
  const [icon, setIcon] = useState(editing?.icon ?? "");
  const [detected, setDetected] = useState(editing?.detectedIcon ?? "");
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The folder of a saved project looked at again, so 重新检测 shows its result here.
  const unchangedFolder = editing && folder === editing.folderPath;

  const chooseFolder = async () => {
    setChoosing(true);
    const choice = await run(Atlas.chooseFolder(folder));
    setChoosing(false);
    if (!choice?.path) return;
    setFolder(choice.path);
    setFolderExists(true);
    setDetected(choice.icon);
    setError("");
    // A project without a name takes its folder's.
    if (!name.trim()) setName(choice.name);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const draft = { name, folderPath: folder, icon };
      if (editing) await editProject(editing.id, draft);
      else await addProject(draft);
      closeProject();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const shown = icon || detected;
  return (
    <>
      <DialogHeader className="flex-row items-center gap-1.5">
        <DialogTitle>{editing ? "编辑项目" : "新建项目"}</DialogTitle>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="说明"
              className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">选好文件夹后，没填的名称用文件夹名，图标自动用项目自己的。</TooltipContent>
        </Tooltip>
      </DialogHeader>

      <div className="flex min-w-0 items-start gap-3">
        <IconPopover
          open={picking}
          onOpenChange={setPicking}
          value={icon}
          fallback={FolderKanban}
          onPick={(i) => {
            setIcon(i);
            setPicking(false);
          }}
          auto={{
            detected,
            hasFolder: !!folder,
            onDetect: unchangedFolder
              ? async () => {
                  const p = await detectProjectIcon(editing.id);
                  if (p) setDetected(p.detectedIcon);
                }
              : undefined,
          }}
        >
          <button
            type="button"
            aria-label="更换图标"
            className="group relative flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border transition-all duration-150 hover:ring-primary/60"
          >
            <EntityIcon
              icon={shown}
              fallback={FolderKanban}
              className="size-9 text-muted-foreground transition-transform duration-200 group-hover:scale-90"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 text-foreground opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
              <Pencil className="size-4" />
            </span>
            {!icon && detected && (
              <span className="absolute -right-1.5 -bottom-1.5 flex h-4 items-center gap-0.5 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                <Wand className="size-2.5" />
                自动
              </span>
            )}
          </button>
        </IconPopover>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            aria-label="项目名称"
            aria-invalid={!!error}
            placeholder={folder ? "留空就用文件夹名" : "项目名称，比如「鹈鹕骑自行车」"}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {folder ? (
            <div
              className={cn(
                "flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-muted/60 pr-0.5 pl-2.5 text-xs animate-in fade-in-0",
                !folderExists && "text-destructive",
              )}
            >
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 flex-1 truncate">{folderExists ? folder : `文件夹不存在：${folder}`}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-96 break-all">{folder}</TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="xs" className="shrink-0" disabled={choosing} onClick={() => void chooseFolder()}>
                {choosing && <LoaderCircle className="animate-spin" />}
                更换
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="解除绑定"
                className="shrink-0 text-muted-foreground"
                onClick={() => {
                  setFolder("");
                  setDetected("");
                }}
              >
                <X />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="justify-start border-dashed text-muted-foreground"
              disabled={choosing}
              onClick={() => void chooseFolder()}
            >
              {choosing ? <LoaderCircle className="animate-spin" /> : <FolderPlus />}
              选择项目文件夹（可选）
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={closeProject}>
          取消
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {editing ? "保存" : "创建"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The dialog that adds a module, or edits its icon and name. */
export function ModuleDialog() {
  const request = useDialogs((s) => s.module);
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && closeModule()}>
      <DialogContent className="sm:max-w-sm">
        {request && <ModuleForm key={request.module?.id ?? "new"} request={request} />}
      </DialogContent>
    </Dialog>
  );
}

function ModuleForm({ request }: { request: ModuleRequest }) {
  const editing = request.module;
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let id = editing?.id ?? 0;
      if (!editing) id = (await createModule(name)).id;
      else if (name.trim() !== editing.name) await renameModule(id, name);
      if (icon !== (editing?.icon ?? "")) await setModuleIcon(id, icon);
      closeModule();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "编辑模块" : "新建模块"}</DialogTitle>
      </DialogHeader>
      <div className="flex items-start gap-3">
        <IconPopover
          open={picking}
          onOpenChange={setPicking}
          value={icon}
          fallback={Boxes}
          onPick={(i) => {
            setIcon(i);
            setPicking(false);
          }}
        >
          <button
            type="button"
            aria-label="更换图标"
            className="group relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border transition-all duration-150 hover:ring-primary/60"
          >
            <EntityIcon
              icon={icon}
              fallback={Boxes}
              className="size-6 text-muted-foreground transition-transform duration-200 group-hover:scale-90"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 text-foreground opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
              <Pencil className="size-4" />
            </span>
          </button>
        </IconPopover>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2">
          <Input
            autoFocus
            value={name}
            maxLength={40}
            aria-label="模块名称"
            aria-invalid={!!error}
            placeholder="模块名称，比如「武器系统」"
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeModule}>
          取消
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {editing ? "保存" : "创建"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** The dialog that adds an organization, or edits its icon and name. */
export function OrgDialog() {
  const request = useDialogs((s) => s.org);
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && closeOrg()}>
      <DialogContent className="sm:max-w-sm">
        {request && <OrgForm key={request.org?.id ?? "new"} request={request} />}
      </DialogContent>
    </Dialog>
  );
}

function OrgForm({ request }: { request: OrgRequest }) {
  const editing = request.org;
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? "");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fallback = orgFallback(editing?.personal ?? false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (editing) await editOrg(editing.id, { name, icon });
      else await createOrg({ name, icon });
      closeOrg();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="flex-row items-center gap-1.5">
        <DialogTitle>{editing ? "编辑组织" : "新建组织"}</DialogTitle>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="说明"
              className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">组织把不同来源的项目分开，比如个人和公司。已有的项目右键「移到组织」。</TooltipContent>
        </Tooltip>
      </DialogHeader>
      <div className="flex items-start gap-3">
        <IconPopover
          open={picking}
          onOpenChange={setPicking}
          value={icon}
          fallback={fallback}
          onPick={(i) => {
            setIcon(i);
            setPicking(false);
          }}
        >
          <button
            type="button"
            aria-label="更换图标"
            className="group relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border transition-all duration-150 hover:ring-primary/60"
          >
            <EntityIcon
              icon={icon}
              fallback={fallback}
              className="size-6 text-muted-foreground transition-transform duration-200 group-hover:scale-90"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 text-foreground opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
              <Pencil className="size-4" />
            </span>
          </button>
        </IconPopover>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2">
          <Input
            autoFocus
            value={name}
            maxLength={40}
            aria-label="组织名称"
            aria-invalid={!!error}
            placeholder="组织名称，比如「公司」「开源」"
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeOrg}>
          取消
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {editing ? "保存" : "创建"}
        </Button>
      </DialogFooter>
    </>
  );
}
