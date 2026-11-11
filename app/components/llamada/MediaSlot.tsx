import Image from "next/image";
import { Camera, Video } from "lucide-react";

import type { MediaSlot as Slot } from "@/lib/content/llamada-landing";

/**
 * Un espacio de video o foto en `/llamada`. Con `src`, el video o la foto. Sin
 * él, un recuadro que dice qué va ahí y qué grabar: así Dayana ve en la misma
 * página qué material falta.
 */

const RATIO: Record<NonNullable<Slot["ratio"]>, string> = {
  "16/9": "aspect-video",
  "9/16": "aspect-[9/16]",
  "4/5": "aspect-[4/5]",
  "1/1": "aspect-square",
};

const youtubeId = (src: string): string | null =>
  src.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)?.[1] ?? null;

const MediaSlot = ({ slot, className = "", sizes = "100vw" }: { slot: Slot; className?: string; sizes?: string }) => {
  const box = `relative w-full overflow-hidden rounded-2xl ${RATIO[slot.ratio ?? "16/9"]} ${className}`;

  if (slot.src) {
    const yt = youtubeId(slot.src);
    if (yt) {
      return (
        <div className={`${box} bg-ink`}>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0`}
            title={slot.label}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            className="absolute inset-0 size-full"
          />
        </div>
      );
    }
    if (slot.kind === "video") {
      return (
        <div className={`${box} bg-ink`}>
          <video src={slot.src} poster={slot.poster} controls playsInline preload="metadata" className="absolute inset-0 size-full object-cover">
            {slot.label}
          </video>
        </div>
      );
    }
    return (
      <div className={`${box} bg-ink/40`}>
        <Image src={slot.src} alt={slot.alt ?? ""} fill sizes={sizes} className="object-cover object-top" />
      </div>
    );
  }

  const Icon = slot.kind === "video" ? Video : Camera;
  return (
    <div
      className={`${box} flex flex-col items-center justify-center gap-2 border-2 border-dashed border-linen/35 bg-linen/[0.06] p-5 text-center`}
      data-media-slot={slot.id}
    >
      <Icon className="size-7 text-terracotta" aria-hidden="true" />
      <p className="font-[font2] text-xs uppercase tracking-[0.2em] text-linen">
        {slot.kind === "video" ? "Video pendiente" : "Foto pendiente"} · {slot.label}
      </p>
      <p className="max-w-md font-[font1] text-xs leading-snug text-linen/70">{slot.brief}</p>
    </div>
  );
};

export default MediaSlot;
