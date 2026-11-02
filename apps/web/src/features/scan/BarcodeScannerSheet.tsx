import {
  CameraOff,
  Flashlight,
  FlashlightOff,
  Lock,
  ScanBarcode,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { cameraPermissionHelp } from './camera-help';
import { useBarcodeScanner, type ScannerState } from './use-barcode-scanner';

export interface BarcodeScannerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the normalised code (EAN-13/EAN-8 as printed, UPC padded to 13 digits); the caller closes the sheet. */
  onDetected: (code: string) => void;
  /** Shown under the title; defaults to the generic instruction. */
  description?: string | undefined;
}

/**
 * Camera barcode scanner (Phase 10b): rear camera preview with a viewfinder, torch toggle when the
 * camera has one, and a state for every way the camera can fail to appear. Reads EAN-13, EAN-8,
 * UPC-A and UPC-E; accepts a code once two consecutive frames agree.
 */
export function BarcodeScannerSheet({
  open,
  onOpenChange,
  onDetected,
  description,
}: BarcodeScannerSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Scan barcode"
      description={description ?? 'Point the camera at the barcode on the package.'}
      className="h-[92dvh] sm:h-[36rem] sm:max-w-[26rem]"
      autoFocusFirstField={false}
      footer={
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
    >
      <ScannerView active={open} onDetected={onDetected} />
    </Sheet>
  );
}

interface ScannerViewProps {
  active: boolean;
  onDetected: (code: string) => void;
}

/** Mounted only while the dialog content is, so the camera starts on open and stops on close. */
function ScannerView({ active, onDetected }: ScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state, torch, retry } = useBarcodeScanner({ active, videoRef, onDetected });
  const live = state.kind === 'scanning' || state.kind === 'found';

  return (
    <div
      className="relative -mx-5 -mb-5 flex h-[calc(100%+1.25rem)] min-h-[18rem] flex-col overflow-hidden bg-black text-white"
      data-scanner-state={state.kind}
      data-scanner-engine={state.kind === 'scanning' ? state.engine : undefined}
    >
      <video
        ref={videoRef}
        className={cn('absolute inset-0 size-full object-cover', !live && 'invisible')}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
      />

      {live ? (
        <Viewfinder found={state.kind === 'found'} />
      ) : (
        <StateMessage state={state} onRetry={retry} />
      )}

      {live ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-5 pt-10 pb-5"
          aria-live="polite"
        >
          <p className="text-sm font-medium drop-shadow">
            {state.kind === 'found' ? (
              <>
                Found <span className="tabular">{state.code}</span>
              </>
            ) : (
              'Looking for a barcode…'
            )}
          </p>
          {torch.available ? (
            <button
              type="button"
              onClick={torch.toggle}
              aria-pressed={torch.on}
              aria-label={torch.on ? 'Turn torch off' : 'Turn torch on'}
              className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
            >
              {torch.on ? (
                <Flashlight className="size-5" aria-hidden="true" />
              ) : (
                <FlashlightOff className="size-5" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Corner-bracketed window with a sweeping line; the mask outside it dims the rest of the frame. */
function Viewfinder({ found }: { found: boolean }) {
  const colour = found ? 'border-success' : 'border-white';
  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <div
        className={cn(
          'relative aspect-[8/5] w-[78%] max-w-[22rem] rounded-xl transition-colors',
          found
            ? 'shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]'
            : 'shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]',
        )}
      >
        {(
          [
            'top-0 left-0 rounded-tl-xl border-t-4 border-l-4',
            'top-0 right-0 rounded-tr-xl border-t-4 border-r-4',
            'bottom-0 left-0 rounded-bl-xl border-b-4 border-l-4',
            'bottom-0 right-0 rounded-br-xl border-b-4 border-r-4',
          ] as const
        ).map((corner) => (
          <span key={corner} className={cn('absolute size-7', corner, colour)} />
        ))}
        {found ? null : (
          <div className="absolute inset-x-4 top-1/2 h-0.5 overflow-visible">
            <div className="animate-scan-line h-0.5 w-full rounded-full bg-accent shadow-[0_0_8px_2px_var(--color-accent)]" />
          </div>
        )}
      </div>
    </div>
  );
}

function StateMessage({ state, onRetry }: { state: ScannerState; onRetry: () => void }) {
  if (state.kind === 'requesting') {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
        role="status"
        aria-live="polite"
      >
        <Spinner className="size-7 text-white/80" />
        <div>
          <p className="text-base font-semibold">Starting the camera…</p>
          <p className="mt-1 text-sm text-white/70">
            If the browser asks, choose <span className="font-medium text-white">Allow</span>.
          </p>
        </div>
      </div>
    );
  }
  const copy = stateCopy(state);
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center"
      role="alert"
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-white/10">
        <copy.icon className="size-7" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">{copy.title}</h3>
      <p className="mt-1 max-w-xs text-sm text-white/70">{copy.message}</p>
      {copy.retry ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-5 bg-white/15 text-white hover:bg-white/25"
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function stateCopy(state: Exclude<ScannerState, { kind: 'requesting' }>): {
  icon: LucideIcon;
  title: string;
  message: string;
  retry: boolean;
} {
  switch (state.kind) {
    case 'denied':
      return {
        icon: Lock,
        title: 'Camera access was denied',
        message: cameraPermissionHelp(),
        retry: true,
      };
    case 'no-camera':
      return {
        icon: CameraOff,
        title: 'No camera found',
        message:
          'This device has no camera Plate can use. You can type the barcode digits into Search online instead.',
        retry: true,
      };
    case 'busy':
      return {
        icon: CameraOff,
        title: 'The camera is not available',
        message: 'Another app or tab may be using it. Close that and try again.',
        retry: true,
      };
    case 'unsupported':
      return state.reason === 'insecure'
        ? {
            icon: Lock,
            title: 'Scanning needs a secure connection',
            message:
              'Browsers only allow camera access over HTTPS (or on localhost). Open Plate over HTTPS to scan; typing the barcode into Search online still works.',
            retry: false,
          }
        : state.reason === 'no-media'
          ? {
              icon: CameraOff,
              title: 'This browser cannot access the camera',
              message:
                'Camera scanning is not supported here. Type the barcode digits into Search online instead.',
              retry: false,
            }
          : {
              icon: ScanBarcode,
              title: 'The barcode decoder did not load',
              message:
                'The decoder could not be downloaded or started. Check the connection and try again.',
              retry: true,
            };
    case 'scanning':
    case 'found':
      // Rendered by the viewfinder, never here.
      return { icon: ScanBarcode, title: '', message: '', retry: false };
  }
}
