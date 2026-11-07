import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { isComposing } from "@/lib/keys";
import { useDialogs } from "@/state/dialogs";

const closeName = () => useDialogs.setState({ name: null });
const closeConfirm = () => useDialogs.setState({ confirm: null });

/** The dialog that asks for a name; errors from saving show under the field. */
export function NameDialog() {
  const request = useDialogs((s) => s.name);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Each request starts the field over, from its initial name.
  const [shown, setShown] = useState(request);
  if (request !== shown) {
    setShown(request);
    if (request) {
      setValue(request.initial ?? "");
      setError("");
      setBusy(false);
    }
  }

  const submit = async () => {
    if (!request || busy) return;
    setBusy(true);
    try {
      await request.onSubmit(value);
      closeName();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && closeName()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Input
            autoFocus
            value={value}
            placeholder={request?.placeholder}
            aria-invalid={!!error}
            onChange={(e) => {
              setValue(e.target.value);
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
        <DialogFooter>
          <Button variant="outline" onClick={closeName}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {request?.confirmText ?? "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The dialog that confirms what cannot be undone. */
export function ConfirmDialog() {
  const request = useDialogs((s) => s.confirm);
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && closeConfirm()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description && <AlertDialogDescription>{request.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? "destructive" : "default"}
            onClick={() => {
              void request?.onConfirm();
            }}
          >
            {request?.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
