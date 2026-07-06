import { drivePreviewUrl } from "@/lib/lms/drive";
import { Button } from "@/app/components/ui/button";

type DriveRecordingEmbedProps = {
  url: string;
  title: string;
};

const DriveRecordingEmbed = ({ url, title }: DriveRecordingEmbedProps) => {
  const previewUrl = drivePreviewUrl(url);

  if (!previewUrl) {
    return (
      <Button variant="outline" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
        Ver grabación
      </Button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
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
