import { Room, Track, VideoPresets, LocalTrack } from 'livekit-client';

const CAM_PIP = VideoPresets.h360.resolution;
const CAM_LIVE = VideoPresets.h540.resolution;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

async function waitForNoScreenShare(room: Room, maxMs = 1200): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (!room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track) return;
    await delay(100);
  }
}

async function waitForCameraTrack(room: Room, maxMs = 2000): Promise<LocalTrack | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const t = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalTrack | undefined;
    if (t) return t;
    await delay(150);
  }
  return (room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalTrack) ?? null;
}

/** Publish camera again for viewers after screen share stops. */
export async function restoreCameraForViewers(
  room: Room,
  previewTrack?: LocalTrack | null,
): Promise<LocalTrack | null> {
  // Screen share teardown can lag on Android — wait so we don't fight renegotiation.
  await waitForNoScreenShare(room);

  const existing = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (existing?.track) {
    if (existing.isMuted) {
      try { await existing.unmute(); } catch (_) {}
    }
    return existing.track as LocalTrack;
  }

  const track = previewTrack;
  if (track) {
    try {
      // MediaStreamTrack may already be ended after long share sessions.
      const media = (track as any)?.mediaStreamTrack;
      if (!media || media.readyState === 'ended') {
        try { await track.stop(); } catch (_) {}
      } else {
        await room.localParticipant.publishTrack(track, {
          source: Track.Source.Camera,
          simulcast: false,
          videoEncoding: { maxBitrate: 480_000, maxFramerate: 18 },
        });
        const after = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalTrack | undefined;
        if (after) return after;
      }
    } catch (_) {
      try { await track.stop(); } catch (_) {}
    }
  }

  // Fresh capture — retry; first attempt often fails right after screen-share stop.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await room.localParticipant.setCameraEnabled(false).catch(() => {});
      await delay(120);
      await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });
      const cam = await waitForCameraTrack(room, 1500);
      if (cam) return cam;
    } catch (_) {
      await delay(200);
    }
  }

  return (room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalTrack) ?? null;
}
