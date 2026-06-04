import { Room, Track, VideoPresets, LocalTrack } from 'livekit-client';

const CAM_PIP = VideoPresets.h360.resolution;
const CAM_LIVE = VideoPresets.h540.resolution;

/**
 * Unpublish camera for viewers but keep capture for host preview (stopOnUnpublish: false).
 * Returns the track to keep in context for pip / VideoView.
 */
export async function prepareCameraForScreenShare(room: Room): Promise<LocalTrack | null> {
  let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) {
    await room.localParticipant.setCameraEnabled(true, { resolution: CAM_PIP });
    pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  }
  const track = pub?.track as LocalTrack | undefined;
  if (!track) return null;
  if (pub) {
    await room.localParticipant.unpublishTrack(track, false);
  }
  return track;
}

/** Publish camera again for viewers after screen share stops. */
export async function restoreCameraForViewers(
  room: Room,
  previewTrack?: LocalTrack | null,
): Promise<void> {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (pub?.track) {
    if (pub.isMuted) await pub.unmute();
    return;
  }
  const track = previewTrack;
  if (track) {
    try {
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Camera,
        simulcast: false,
        videoEncoding: { maxBitrate: 480_000, maxFramerate: 18 },
      });
      const after = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (after?.track) return;
    } catch (_) {
      /* preview track may have ended — fall through to fresh capture */
    }
  }
  await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });
}
