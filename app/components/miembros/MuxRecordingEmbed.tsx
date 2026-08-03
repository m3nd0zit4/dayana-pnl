"use client";

import { useEffect, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";

type MuxRecordingEmbedProps = {
  classId: string;
  title: string;
};

type TokenState =
  | { status: "loading" }
  | { status: "ready"; token: string; playbackId: string }
  | { status: "error"; message: string };

const MuxRecordingEmbed = ({ classId, title }: MuxRecordingEmbedProps) => {
  const [state, setState] = useState<TokenState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/miembros/classes/${classId}/playback-token`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ token: string; playbackId: string }>;
      })
      .then(({ token, playbackId }) => {
        if (!cancelled) setState({ status: "ready", token, playbackId });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "error",
            message: "No se pudo cargar la grabación. Intenta de nuevo.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [classId]);

  if (state.status === "loading") {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black text-sm text-white/60">
        Cargando video…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-(--card-spacing) text-sm text-muted-foreground">
        {state.message}
      </div>
    );
  }

  return (
    <div className="bg-black">
      <MuxPlayer
        playbackId={state.playbackId}
        tokens={{ playback: state.token }}
        metadata={{ video_title: title }}
        streamType="on-demand"
        className="aspect-video w-full"
      />
    </div>
  );
};

export default MuxRecordingEmbed;
