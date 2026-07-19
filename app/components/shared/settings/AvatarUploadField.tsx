"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

type AvatarUploadFieldProps = {
  uploadUrl: string;
  name: string;
  initialAvatarUrl: string | null;
};

const AvatarUploadField = ({
  uploadUrl,
  name,
  initialAvatarUrl,
}: AvatarUploadFieldProps) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setLoading(true);
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(uploadUrl, { method: "POST", body: form });
    setLoading(false);

    if (!res.ok) {
      setError("No se pudo subir la imagen. Intenta de nuevo.");
      return;
    }
    const data = (await res.json()) as { avatarUrl: string };
    setAvatarUrl(data.avatarUrl);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar size="lg">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="space-y-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onPick}
        >
          {loading ? "Subiendo…" : "Cambiar foto"}
        </Button>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default AvatarUploadField;
