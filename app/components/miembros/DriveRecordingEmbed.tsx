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
        className="portal-btn-secondary"
      >
        Ver grabación
      </a>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--portal-border,rgba(20,18,16,0.08))] bg-black">
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
