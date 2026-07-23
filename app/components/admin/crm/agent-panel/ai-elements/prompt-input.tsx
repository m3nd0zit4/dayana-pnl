"use client";

import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ComponentProps,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { nanoid } from "nanoid";
import type { ChatStatus, FileUIPart } from "ai";
import { ArrowUpIcon, FileIcon, ImageIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/app/components/ui/input-group";
import { Spinner } from "@/app/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Trimmed port of Vercel AI Elements' `prompt-input.tsx` (see
 * conversation.tsx header comment). The original (~1300 lines) also covers a
 * cross-instance provider, referenced-source citations, screenshot capture,
 * model-select/hover-card/tabs variants — none of which this CRM panel needs.
 * Kept: the composer form, attachment state (local, no provider), the "+"
 * action menu, and the toolbar button building blocks. One addition not in
 * the original: an attachment preview strip, since the source scaffold
 * attaches files invisibly with no chip shown before send — fine for a demo,
 * not for a real operator tool.
 */

// ============================================================================
// Attachments context (local to one PromptInput instance)
// ============================================================================

type AttachmentFile = FileUIPart & { id: string };

interface AttachmentsContext {
  files: AttachmentFile[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
}

const AttachmentsContextInstance = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const ctx = useContext(AttachmentsContextInstance);
  if (!ctx) {
    throw new Error("usePromptInputAttachments must be used within a PromptInput");
  }
  return ctx;
};

// ============================================================================
// PromptInput root
// ============================================================================

export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit" | "onError"> & {
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: { code: "max_files" | "max_file_size" | "accept"; message: string }) => void;
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple = true,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [items, setItems] = useState<AttachmentFile[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept?.trim()) return true;
      return accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((pattern) => (pattern.endsWith("/*") ? f.type.startsWith(pattern.slice(0, -1)) : f.type === pattern));
    },
    [accept]
  );

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter(matchesAccept);
      if (incoming.length > 0 && accepted.length === 0) {
        onError?.({ code: "accept", message: "Ningún archivo coincide con los tipos aceptados." });
        return;
      }
      const sized = maxFileSize ? accepted.filter((f) => f.size <= maxFileSize) : accepted;
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({ code: "max_file_size", message: "Todos los archivos superan el tamaño máximo." });
        return;
      }

      setItems((prev) => {
        const capacity = typeof maxFiles === "number" ? Math.max(0, maxFiles - prev.length) : undefined;
        const capped = typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({ code: "max_files", message: "Demasiados archivos — algunos no se agregaron." });
        }
        const next = capped.map((file) => ({
          id: nanoid(),
          type: "file" as const,
          filename: file.name,
          mediaType: file.type,
          url: URL.createObjectURL(file),
        }));
        return [...prev, ...next];
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const f of prev) if (f.url) URL.revokeObjectURL(f.url);
      return [];
    });
  }, []);

  const openFileDialog = useCallback(() => inputRef.current?.click(), []);

  useEffect(
    () => () => {
      for (const f of itemsRef.current) if (f.url) URL.revokeObjectURL(f.url);
    },
    []
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) add(event.currentTarget.files);
      event.currentTarget.value = "";
    },
    [add]
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({ files: items, add, remove, clear, openFileDialog }),
    [items, add, remove, clear, openFileDialog]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const text = (formData.get("message") as string) || "";
      form.reset();

      try {
        const result = onSubmit({ text, files: items.map(({ id: _id, ...rest }) => rest) }, event);
        if (result instanceof Promise) {
          await result;
        }
        clear();
      } catch {
        // Don't clear on error — user may want to retry.
      }
    },
    [items, onSubmit, clear]
  );

  return (
    <AttachmentsContextInstance.Provider value={attachmentsCtx}>
      <input
        accept={accept}
        aria-label="Adjuntar archivos"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Adjuntar archivos"
        type="file"
      />
      <form className="w-full" onSubmit={handleSubmit} ref={formRef} {...props}>
        {items.length > 0 && <PromptInputAttachmentsPreview files={items} onRemove={remove} />}
        <InputGroup
          className={cn(
            "overflow-hidden rounded-2xl bg-card shadow-sm",
            "focus-within:border-foreground has-[[data-slot=input-group-control]:focus-visible]:border-foreground",
            className
          )}
        >
          {children}
        </InputGroup>
      </form>
    </AttachmentsContextInstance.Provider>
  );
};

const PromptInputAttachmentsPreview = ({
  files,
  onRemove,
}: {
  files: AttachmentFile[];
  onRemove: (id: string) => void;
}) => (
  <div className="mb-1.5 flex flex-wrap gap-1.5">
    {files.map((file) => {
      const isImage = file.mediaType.startsWith("image/");
      return (
        <span
          key={file.id}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs"
        >
          {isImage ? <ImageIcon className="size-3.5 text-muted-foreground" /> : <FileIcon className="size-3.5 text-muted-foreground" />}
          <span className="max-w-32 truncate">{file.filename}</span>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Quitar ${file.filename}`}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      );
    })}
  </div>
);

// ============================================================================
// Textarea
// ============================================================================

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "Pregunta lo que quieras…",
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing || e.shiftKey) return;
        e.preventDefault();
        const { form } = e.currentTarget;
        const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitButton?.disabled) return;
        form?.requestSubmit();
      }

      if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
        e.preventDefault();
        const last = attachments.files.at(-1);
        if (last) attachments.remove(last.id);
      }
    },
    [onKeyDown, isComposing, attachments]
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments]
  );

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-18", className)}
      name="message"
      onChange={onChange}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
    />
  );
};

// ============================================================================
// Layout helpers
// ============================================================================

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, "align">;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon align="block-end" className={cn("justify-between gap-1", className)} {...props} />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />
);

// ============================================================================
// Buttons
// ============================================================================

export type PromptInputButtonTooltip = string | { content: ReactNode; side?: ComponentProps<typeof TooltipContent>["side"] };

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({ variant = "ghost", className, size, tooltip, ...props }: PromptInputButtonProps) => {
  const resolvedSize = size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");
  // A hover tooltip alone doesn't give icon-only buttons an accessible name —
  // screen readers and keyboard/touch users never see it. Derive aria-label
  // from a string tooltip unless the caller already set one explicitly.
  const ariaLabel = props["aria-label"] ?? (typeof tooltip === "string" ? tooltip : undefined);
  const button = (
    <InputGroupButton
      className={cn(className)}
      size={resolvedSize}
      type="button"
      variant={variant}
      {...props}
      aria-label={ariaLabel}
    />
  );

  if (!tooltip) return button;

  const content = typeof tooltip === "string" ? tooltip : tooltip.content;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
};

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming";

  let icon = <ArrowUpIcon className="size-4" />;
  if (status === "submitted") icon = <Spinner />;
  else if (status === "streaming") icon = <SquareIcon className="size-4" />;
  else if (status === "error") icon = <XIcon className="size-4" />;

  const handleClick: NonNullable<ComponentProps<typeof InputGroupButton>["onClick"]> = useCallback(
    (e) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick]
  );

  return (
    <InputGroupButton
      aria-label={isGenerating ? "Detener" : "Enviar"}
      className={cn("absolute right-2.5 bottom-2.5 rounded-full", className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? icon}
    </InputGroupButton>
  );
};

// ============================================================================
// "+" action menu
// ============================================================================

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => <DropdownMenu {...props} />;

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;
export const PromptInputActionMenuTrigger = ({ className, children, ...props }: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger
    render={
      <PromptInputButton className={className} {...props}>
        {children ?? <PlusIcon className="size-4" />}
      </PromptInputButton>
    }
  />
);

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>;
export const PromptInputActionMenuContent = ({ className, ...props }: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn("w-56", className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<typeof DropdownMenuItem>;
export const PromptInputActionMenuItem = ({ className, ...props }: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & { label?: string };

export const PromptInputActionAddAttachments = ({ label = "Archivos", ...props }: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  return (
    <DropdownMenuItem {...props} onClick={(e) => {
      props.onClick?.(e);
      attachments.openFileDialog();
    }}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};
