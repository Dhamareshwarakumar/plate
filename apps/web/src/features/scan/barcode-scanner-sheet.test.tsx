import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeScannerSheet } from './BarcodeScannerSheet';
import type { FrameDetector } from './detector';

// The decoder is replaced by a scripted one: each `detect` call returns the next frame's codes.
const frames: string[][] = [];
const detectorState = { fail: false, disposed: 0 };
vi.mock('./detector', () => ({
  createDetector: async (): Promise<FrameDetector> => {
    if (detectorState.fail) throw new Error('wasm failed');
    return {
      engine: 'native',
      intervalMs: 0,
      detect: async () => frames.shift() ?? [],
      dispose: () => {
        detectorState.disposed += 1;
      },
    };
  },
}));

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => { torch?: boolean };
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeStream(torch: boolean) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { track, stream };
}

/** Installs `navigator.mediaDevices.getUserMedia` answering with `answer` on every call. */
function stubCamera(answer: () => Promise<unknown>) {
  const getUserMedia = vi.fn(answer);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia }, vibrate: vi.fn() });
  return getUserMedia;
}

const domError = (name: string) => {
  const err = new Error(name);
  err.name = name;
  return err;
};

function renderSheet(props: { open?: boolean } = {}) {
  const onDetected = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <BarcodeScannerSheet
      open={props.open ?? true}
      onOpenChange={onOpenChange}
      onDetected={onDetected}
    />,
  );
  return { ...view, onDetected, onOpenChange };
}

const scannerRoot = () => document.querySelector<HTMLElement>('[data-scanner-state]');
const stateIs = (kind: string) =>
  waitFor(() => expect(scannerRoot()?.dataset.scannerState).toBe(kind));

beforeEach(() => {
  frames.length = 0;
  detectorState.fail = false;
  detectorState.disposed = 0;
  // jsdom has no media pipeline: pretend the video has frames and can play.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => HTMLMediaElement.HAVE_ENOUGH_DATA,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BarcodeScannerSheet', () => {
  it('asks for the camera, then scans and accepts a code read twice in a row', async () => {
    const { stream } = fakeStream(false);
    const getUserMedia = stubCamera(async () => stream);
    frames.push(['5000159484695'], ['7394376616228'], [], ['7394376616228']);
    const { onDetected } = renderSheet();

    expect(screen.getByText('Starting the camera…')).toBeInTheDocument();
    await stateIs('scanning');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    expect(scannerRoot()?.dataset.scannerEngine).toBe('native');

    // 5000… then 7394… (different → not yet), an empty frame (does not reset), 7394… again → found.
    await stateIs('found');
    expect(screen.getByText('Found')).toBeInTheDocument();
    expect(screen.getByText('7394376616228')).toBeInTheDocument();
    expect(onDetected).not.toHaveBeenCalled();
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7394376616228'));
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /torch/i })).toBeNull();
  });

  it('stops the stream and releases the decoder when the sheet closes', async () => {
    const { stream, track } = fakeStream(false);
    stubCamera(async () => stream);
    const { rerender, onDetected, onOpenChange } = renderSheet();
    await stateIs('scanning');
    expect(track.stop).not.toHaveBeenCalled();

    rerender(
      <BarcodeScannerSheet open={false} onOpenChange={onOpenChange} onDetected={onDetected} />,
    );
    await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(detectorState.disposed).toBe(1);
  });

  it('toggles the torch through track constraints when the camera has one', async () => {
    const { stream, track } = fakeStream(true);
    stubCamera(async () => stream);
    renderSheet();
    const user = userEvent.setup();
    await stateIs('scanning');

    const torch = await screen.findByRole('button', { name: 'Turn torch on' });
    expect(torch).toHaveAttribute('aria-pressed', 'false');
    await user.click(torch);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Turn torch off' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('explains a denied permission per browser and retries on request', async () => {
    const { stream } = fakeStream(false);
    let calls = 0;
    const getUserMedia = stubCamera(async () => {
      calls += 1;
      if (calls === 1) throw domError('NotAllowedError');
      return stream;
    });
    renderSheet();
    const user = userEvent.setup();

    await stateIs('denied');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Camera access was denied');
    expect(alert).toHaveTextContent(/allow Camera for this site, then try again/);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await stateIs('scanning');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('distinguishes no camera from a camera that will not start', async () => {
    stubCamera(async () => {
      throw domError('NotFoundError');
    });
    const first = renderSheet();
    await stateIs('no-camera');
    expect(screen.getByRole('alert')).toHaveTextContent('No camera found');
    first.unmount();

    stubCamera(async () => {
      throw domError('NotReadableError');
    });
    renderSheet();
    await stateIs('busy');
    expect(screen.getByRole('alert')).toHaveTextContent('The camera is not available');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports an unsupported browser without asking for the camera', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    renderSheet();
    await stateIs('unsupported');
    expect(screen.getByRole('alert')).toHaveTextContent('This browser cannot access the camera');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('blames the missing secure context when the page is plain http', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    try {
      renderSheet();
      await stateIs('unsupported');
      expect(screen.getByRole('alert')).toHaveTextContent('Scanning needs a secure connection');
    } finally {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: undefined });
    }
  });

  it('shows the decoder failure with a retry and stops the camera it already opened', async () => {
    const { stream, track } = fakeStream(false);
    stubCamera(async () => stream);
    detectorState.fail = true;
    renderSheet();
    const user = userEvent.setup();

    await stateIs('unsupported');
    expect(screen.getByRole('alert')).toHaveTextContent('The barcode decoder did not load');
    expect(track.stop).toHaveBeenCalled();

    detectorState.fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await stateIs('scanning');
  });

  it('closes through Cancel', async () => {
    const { stream } = fakeStream(false);
    stubCamera(async () => stream);
    const { onOpenChange } = renderSheet();
    const user = userEvent.setup();
    await stateIs('scanning');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
