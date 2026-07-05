import { drivePreviewUrl } from "@/lib/lms/drive";

type DriveRecordingEmbedProps = {
  url: string;
  title: string;
};

const DriveRecordingEmbed = ({ url, title }: DriveRecordingEmbedProps) => {
  const previewUrl = drivePreviewUrl(url);

  if (!previewUrl) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-full border border-linen/30 px-6 py-3 font-[font2] uppercase text-xs tracking-[0.25em] text-white/80 transition-colors hover:bg-linen/5 hover:text-white"
      >
        Ver grabación
      </a>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-linen/15 bg-black/60">
      <iframe
        src={previewUrl}
        title={`Grabación — ${title}`}
        allow="autoplay; fullscreen"
        allowFullScreen
        className="aspect-video w-full"
      />
    </div>
  );
};

export default DriveRecordingEmbed;
