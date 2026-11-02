import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createDetector, type FrameDetector } from './detector';

export type ScannerState =
  /** Camera permission prompt and/or decoder download in progress. */
  | { kind: 'requesting' }
  | { kind: 'scanning'; engine: FrameDetector['engine'] }
  /** Accepted code; `onDetected` fires after a short beat so the user sees what was read. */
  | { kind: 'found'; code: string }
  | { kind: 'denied' }
  | { kind: 'no-camera' }
  /** The camera exists but could not be started (another app holds it, hardware error). */
  | { kind: 'busy' }
  | { kind: 'unsupported'; reason: 'insecure' | 'no-media' | 'no-detector' };

export interface UseBarcodeScannerOptions {
  /** Runs the camera while true; everything is torn down when it flips to false or on unmount. */
  active: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Called once per activation with the accepted code (the same code in two consecutive reads). */
  onDetected: (code: string) => void;
}

export interface BarcodeScanner {
  state: ScannerState;
  torch: { available: boolean; on: boolean; toggle: () => void };
  /** Starts over after denied / busy / no-camera (the user may have changed a setting). */
  retry: () => void;
}

/** How long the "found" frame stays before the code is handed over. */
export const FOUND_MS = 450;

interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

function unsupportedReason(): 'insecure' | 'no-media' | null {
  if (typeof navigator === 'undefined') return 'no-media';
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    // Browsers hide mediaDevices entirely on plain http:// (other than localhost).
    return typeof window !== 'undefined' && window.isSecureContext === false
      ? 'insecure'
      : 'no-media';
  }
  return null;
}

/** Rear camera preferred, not required: a laptop with one front camera still scans. */
async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}

export function cameraErrorState(err: unknown): ScannerState {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { kind: 'denied' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'no-camera' };
    default:
      // NotReadableError / AbortError / TrackStartError: the device is there but would not start.
      return { kind: 'busy' };
  }
}

/**
 * Camera + decoder lifecycle behind `BarcodeScannerSheet`. Permission and decoder set-up run in
 * parallel; frames are decoded on a timer (`detector.intervalMs`) and a code is accepted only when
 * two consecutive reads agree (frames with nothing in them do not reset the count). The stream is
 * stopped on close, on unmount and after a code was accepted.
 */
export function useBarcodeScanner({
  active,
  videoRef,
  onDetected,
}: UseBarcodeScannerOptions): BarcodeScanner {
  const unsupported = useMemo(() => unsupportedReason(), []);
  const [state, setState] = useState<ScannerState>(() =>
    unsupported ? { kind: 'unsupported', reason: unsupported } : { kind: 'requesting' },
  );
  const [attempt, setAttempt] = useState(0);
  const [torch, setTorch] = useState({ available: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  // The latest callback without restarting the camera when the parent re-renders.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    if (!active || unsupported) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: FrameDetector | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: string | null = null;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      trackRef.current = null;
    };

    const accept = (code: string) => {
      video.pause();
      if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
      setState({ kind: 'found', code });
      timer = setTimeout(() => {
        if (!cancelled) onDetectedRef.current(code);
      }, FOUND_MS);
    };

    const tick = async () => {
      if (cancelled || !detector) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        let codes: string[] = [];
        try {
          codes = await detector.detect(video);
        } catch {
          // A frame that failed to decode is skipped, not fatal.
        }
        if (cancelled) return;
        const code = codes[0];
        if (code !== undefined) {
          if (code === last) {
            accept(code);
            return;
          }
          last = code;
        }
      }
      timer = setTimeout(() => void tick(), detector.intervalMs);
    };

    void (async () => {
      const [detectorResult, streamResult] = await Promise.allSettled([
        createDetector(),
        openCamera(),
      ]);
      if (streamResult.status === 'fulfilled') stream = streamResult.value;
      if (detectorResult.status === 'fulfilled') detector = detectorResult.value;
      if (cancelled) {
        stopStream();
        detector?.dispose();
        return;
      }
      if (streamResult.status === 'rejected') {
        detector?.dispose();
        setState(cameraErrorState(streamResult.reason));
        return;
      }
      if (!detector) {
        stopStream();
        setState({ kind: 'unsupported', reason: 'no-detector' });
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay of a muted, user-initiated camera stream is allowed everywhere; ignore otherwise.
      }
      if (cancelled) return;
      const track = stream?.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const capabilities =
        track && typeof track.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : null;
      setTorch({ available: capabilities?.torch === true, on: false });
      setState({ kind: 'scanning', engine: detector.engine });
      void tick();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopStream();
      detector?.dispose();
      video.srcObject = null;
    };
  }, [active, attempt, unsupported, videoRef]);

  const toggleTorch = () => {
    const track = trackRef.current;
    if (!track || !torch.available) return;
    const next = !torch.on;
    const constraint: TorchConstraintSet = { torch: next };
    track
      .applyConstraints({ advanced: [constraint] })
      .then(() => setTorch((t) => ({ ...t, on: next })))
      .catch(() => setTorch((t) => ({ ...t, available: false })));
  };

  const retry = () => {
    if (unsupported) return;
    setTorch({ available: false, on: false });
    setState({ kind: 'requesting' });
    setAttempt((n) => n + 1);
  };

  return { state, torch: { ...torch, toggle: toggleTorch }, retry };
}
