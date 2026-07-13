import { useId, useLayoutEffect, useRef, type PropsWithChildren } from 'react';

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface AccessibleDialogProps extends PropsWithChildren {
  className?: string;
  descriptionId?: string;
  onDismiss: () => void;
  open: boolean;
  title: string;
}

interface DialogStackEntry {
  dialog: HTMLElement;
  dismiss: () => void;
  lastFocused?: HTMLElement;
  restoreFocus?: HTMLElement;
}

const dialogStack: DialogStackEntry[] = [];
let listenersAttached = false;
let redirectingFocus = false;

function topmostDialog() {
  return dialogStack[dialogStack.length - 1];
}

function focusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter((element) => element.isConnected);
}

function focusInside(entry: DialogStackEntry, preferred?: HTMLElement) {
  const preferredIsFocusable = preferred?.isConnected &&
    entry.dialog.contains(preferred) &&
    preferred.matches(focusableSelector);
  const target = preferredIsFocusable
    ? preferred
    : focusableElements(entry.dialog)[0] ?? entry.dialog;
  entry.lastFocused = target;
  if (document.activeElement === target) return;
  redirectingFocus = true;
  try {
    target.focus();
  } finally {
    redirectingFocus = false;
  }
}

function handleDocumentFocusIn(event: FocusEvent) {
  if (redirectingFocus) return;
  const entry = topmostDialog();
  if (!entry) return;
  const target = event.target;
  if (target instanceof HTMLElement && entry.dialog.contains(target)) {
    entry.lastFocused = target;
    return;
  }
  focusInside(entry, entry.lastFocused);
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  const entry = topmostDialog();
  if (!entry) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    entry.dismiss();
    return;
  }
  if (event.key !== 'Tab') return;

  const controls = focusableElements(entry.dialog);
  if (controls.length === 0) {
    event.preventDefault();
    focusInside(entry);
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  const outsideBoundary = !(active instanceof Node) || !entry.dialog.contains(active);
  const outsideRovingOrder = !(active instanceof HTMLElement) || !controls.includes(active);
  if (outsideBoundary || outsideRovingOrder) {
    event.preventDefault();
    focusInside(entry, event.shiftKey ? last : first);
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    focusInside(entry, last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusInside(entry, first);
  }
}

function attachDocumentListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('focusin', handleDocumentFocusIn);
  document.addEventListener('keydown', handleDocumentKeyDown);
}

function detachDocumentListeners() {
  if (!listenersAttached || dialogStack.length > 0) return;
  listenersAttached = false;
  document.removeEventListener('focusin', handleDocumentFocusIn);
  document.removeEventListener('keydown', handleDocumentKeyDown);
}

function registerDialog(entry: DialogStackEntry) {
  dialogStack.push(entry);
  attachDocumentListeners();
  focusInside(entry);
}

function unregisterDialog(entry: DialogStackEntry) {
  const index = dialogStack.indexOf(entry);
  if (index < 0) return;
  const wasTopmost = index === dialogStack.length - 1;
  dialogStack.splice(index, 1);

  if (!wasTopmost) {
    const child = dialogStack[index];
    if (child?.restoreFocus && entry.dialog.contains(child.restoreFocus)) {
      child.restoreFocus = entry.restoreFocus;
    }
    detachDocumentListeners();
    return;
  }

  const parent = topmostDialog();
  if (parent) {
    const restoreInsideParent = entry.restoreFocus && parent.dialog.contains(entry.restoreFocus)
      ? entry.restoreFocus
      : parent.lastFocused;
    focusInside(parent, restoreInsideParent);
  } else if (entry.restoreFocus?.isConnected) {
    entry.restoreFocus.focus();
  }
  detachDocumentListeners();
}

export function AccessibleDialog({
  children,
  className = '',
  descriptionId,
  onDismiss,
  open,
  title,
}: AccessibleDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const stackEntryRef = useRef<DialogStackEntry | undefined>(undefined);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const entry: DialogStackEntry = {
      dialog,
      dismiss: () => onDismissRef.current(),
      restoreFocus: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    };
    stackEntryRef.current = entry;
    registerDialog(entry);
    return () => {
      if (stackEntryRef.current === entry) stackEntryRef.current = undefined;
      unregisterDialog(entry);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          stackEntryRef.current === topmostDialog()
        ) {
          onDismissRef.current();
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`confirmation-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}
