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
      <div className="p-(--card-spacing)">
        <Button variant="outline" nativeButton={false} render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
          Ver grabación
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-black">
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
