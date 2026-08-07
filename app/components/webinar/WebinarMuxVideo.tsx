"use client";

import MuxPlayer from "@mux/mux-player-react";

type WebinarMuxVideoProps = {
  playbackId: string;
  title?: string;
};

/**
 * Vídeo promocional de la landing.
 *
 * Sin `tokens`: la política de reproducción de este asset es `public`, no
 * `signed` como las grabaciones del curso (`MuxRecordingEmbed`). Es material
 * de marketing, así que no hay ruta de token ni JWT que firmar.
 */
const WebinarMuxVideo = ({ playbackId, title }: WebinarMuxVideoProps) => (
  <MuxPlayer
    playbackId={playbackId}
    metadata={title ? { video_title: title } : undefined}
    streamType="on-demand"
    accentColor="#c0654a"
    // `block` no es decorativo: mux-player es un custom element y por defecto
    // se maqueta en línea, así que se apoya en la línea base del texto y deja
    // ~9px de hueco debajo — el fondo negro del contenedor asomaba por ahí.
    className="block aspect-video w-full"
  />
);

export default WebinarMuxVideo;
