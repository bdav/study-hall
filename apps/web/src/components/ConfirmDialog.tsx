import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  /** Opens the dialog; leave it out to open it with `open` instead. */
  trigger?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  /** For a dialog opened from elsewhere, such as a menu item. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Continue',
  onConfirm,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer select-none border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="cursor-pointer select-none border-red-500/30 bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:text-red-200"
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
