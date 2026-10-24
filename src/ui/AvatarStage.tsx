import { useEffect, useRef } from "react";
import type { RemoteVideoTrack } from "livekit-client";
import type { ConnectionState } from "../realtime/RealtimeClient";

/** The avatar's video, or a placeholder until it arrives. */
export function AvatarStage({
  track,
  connection,
}: {
  track: RemoteVideoTrack | null;
  connection: ConnectionState;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!track || !video) return;
    track.attach(video);
    return () => void track.detach(video);
  }, [track]);

  return (
    <section className="avatar-stage" aria-label="Tutor video">
      {/* Muted: the avatar's audio plays through its own element (AvatarSession). */}
      <video ref={videoRef} autoPlay playsInline muted hidden={!track} />
      {!track && (
        <p className="avatar-waiting">
          {connection === "connecting" || connection === "open"
            ? "Waiting for the tutor…"
            : "Connect to meet your tutor."}
        </p>
      )}
    </section>
  );
}
