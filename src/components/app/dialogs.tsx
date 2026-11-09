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
import { useDialogs } from "@/state/dialogs";

const closeConfirm = () => useDialogs.setState({ confirm: null });

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
