"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Local stand-in for AI Elements' `code-block.tsx` — the original pulls in
 * `shiki` for full syntax highlighting, which is overkill here: tool
 * input/output in this agent is always plain CRM JSON, never source code.
 * Same `{code, language}` prop shape `tool.tsx` expects, no highlighting.
 */
export const CodeBlock = ({
  code,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("group/code-block relative", className)}>
      <pre className="max-h-64 overflow-auto p-3 pr-10 text-xs">
        <code className="whitespace-pre-wrap break-words">{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/code-block:opacity-100"
        onClick={handleCopy}
        aria-label="Copiar"
        type="button"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </Button>
    </div>
  );
};
