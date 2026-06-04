import { Track } from 'livekit-client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isScreenSharePublication(pub: any, track?: any): boolean {
  const src = pub?.source ?? track?.source;
  if (
    src === Track.Source.ScreenShare
    || src === 'screen_share'
    || src === 2
  ) {
    return true;
  }
  const name = String(pub?.trackName ?? track?.name ?? '');
  return /screen/i.test(name);
}

export function isVideoPublication(pub: any): boolean {
  return pub?.kind === Track.Kind.Video || pub?.kind === 'video';
}

async function subscribeAndWaitTrack(pub: any, attempts = 40): Promise<any> {
  if (!pub) return null;
  if (!pub.isSubscribed) {
    try { await pub.setSubscribed(true); } catch (_) {}
  }
  for (let i = 0; i < attempts; i += 1) {
    if (pub.track) return pub.track;
    await sleep(50);
  }
  return pub.track ?? null;
}

/** Prefer explicit camera / screen-share publications (same as group calls). */
export async function collectRemoteVideoTracks(room: any) {
  let screen: any = null;
  let camera: any = null;

  for (const participant of room.remoteParticipants.values()) {
    const screenPub = participant.getTrackPublication?.(Track.Source.ScreenShare);
    const camPub = participant.getTrackPublication?.(Track.Source.Camera);

    const screenTrack = await subscribeAndWaitTrack(screenPub);
    const camTrack = await subscribeAndWaitTrack(camPub);
    if (screenTrack) screen = screenTrack;
    if (camTrack) camera = camTrack;
  }

  if (screen && camera) return { screen, camera };

  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (!isVideoPublication(pub)) continue;
      if (!pub.isSubscribed) {
        try { await pub.setSubscribed(true); } catch (_) {}
      }
      const track = pub.track;
      if (!track) continue;
      if (!screen && isScreenSharePublication(pub, track)) screen = track;
      else if (!camera && !isScreenSharePublication(pub, track)) camera = track;
    }
  }

  return { screen, camera };
}
