import type { PushSubscriptionInfo } from '@plate/shared';
import { Bell, BellOff, BellRing, Lock, Smartphone, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Tag } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiClientError } from '@/lib/api';
import { formatDayShort, toDayKey } from '@/lib/dates';
import { usePushDevices, useRemovePushDevice, useSendTestNotification } from './api';
import { usePushSubscription, type PushDeviceStatus } from './use-push-subscription';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiClientError ? err.message : fallback;

/**
 * More → Reminders, the devices (FR-N2): this browser's enrolment (permission → subscription →
 * server), a test notification, and the list of every device that receives reminders.
 */
export function DevicesCard() {
  const devices = usePushDevices();
  const push = usePushSubscription();
  const test = useSendTestNotification();
  const remove = useRemovePushDevice();
  const [removing, setRemoving] = useState<PushSubscriptionInfo | null>(null);

  const endpoint = push.status.kind === 'ready' ? push.status.endpoint : null;
  const thisDevice =
    endpoint !== null ? devices.data?.find((d) => d.endpoint === endpoint) : undefined;

  const onEnable = async () => {
    try {
      if (await push.enable()) toast.success('Reminders enabled on this device');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not enable reminders on this device.'));
    }
  };

  const onDisable = async (device: PushSubscriptionInfo) => {
    try {
      await push.disable(device.id);
      toast('Reminders turned off on this device');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not turn reminders off.'));
    }
  };

  const onTest = () => {
    if (!endpoint) return;
    test.mutate(endpoint, {
      onSuccess: (result) => {
        if (result.sent > 0) toast.success('Test notification sent. It should arrive in a moment.');
        else if (result.removed > 0)
          toast.error('The push service no longer knows this device. Enable it again.');
        else toast.error('The push service refused the message. Try again in a minute.');
      },
      onError: (err) => toast.error(errorMessage(err, 'Could not send the test notification.')),
    });
  };

  const onRemove = (device: PushSubscriptionInfo) => {
    if (device.id === thisDevice?.id) {
      void onDisable(device);
      return;
    }
    setRemoving(device);
  };

  return (
    <Card className="p-0">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Each phone or computer opts in on its own. Reminders arrive even while Plate is closed.
        </CardDescription>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <ThisDevice
          status={push.status}
          enrolled={thisDevice !== undefined}
          busy={push.busy}
          testing={test.isPending}
          onEnable={() => void onEnable()}
          onDisable={() => (thisDevice ? void onDisable(thisDevice) : undefined)}
          onTest={onTest}
          onRecheck={push.recheck}
        />
      </div>

      <section className="border-border border-t">
        <h3 className="text-fg-muted px-4 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase sm:px-5">
          Enabled devices
        </h3>
        {devices.isPending ? (
          <div className="flex flex-col gap-2 px-4 pt-1 pb-4 sm:px-5" aria-busy="true">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : devices.isError ? (
          <ErrorState
            message={devices.error.message}
            onRetry={() => void devices.refetch()}
            retrying={devices.isFetching}
            className="py-6"
          />
        ) : devices.data.length === 0 ? (
          <p className="text-fg-muted px-4 pt-1 pb-4 text-sm sm:px-5">
            No devices yet. Enable reminders on each phone or computer that should get them.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {devices.data.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                current={device.id === thisDevice?.id}
                onRemove={() => onRemove(device)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.deviceLabel ?? 'this device'}?`}
        description="It stops receiving reminders. To get them back, open Plate on that device and enable reminders again."
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          const device = removing;
          remove.mutate(device.id, {
            onSuccess: () => toast(`${device.deviceLabel} removed`),
            onSettled: () => setRemoving(null),
          });
        }}
      />
    </Card>
  );
}

interface ThisDeviceProps {
  status: PushDeviceStatus;
  /** The server lists this browser's subscription. */
  enrolled: boolean;
  busy: boolean;
  testing: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
  onRecheck: () => void;
}

function ThisDevice(props: ThisDeviceProps) {
  const { status, enrolled, busy, testing, onEnable, onDisable, onTest, onRecheck } = props;
  if (status.kind === 'checking') {
    return (
      <div className="flex items-center gap-4" aria-busy="true">
        <Skeleton className="size-12 shrink-0 rounded-2xl" />
        <div className="flex-1">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-2 h-3 w-5/6" />
        </div>
      </div>
    );
  }
  if (status.kind === 'unsupported') {
    const copy = UNSUPPORTED_COPY[status.reason];
    return (
      <Notice icon={copy.icon} title={copy.title} description={copy.description}>
        {status.reason === 'no-worker' ? (
          <Button variant="secondary" size="sm" onClick={onRecheck}>
            Check again
          </Button>
        ) : null}
      </Notice>
    );
  }
  if (status.kind === 'denied') {
    return (
      <Notice
        icon={Lock}
        title="Notifications are blocked for Plate"
        description="Allow them in this browser's site settings (the lock icon next to the address, or on Android ⋮ → Settings → Notifications; on iPhone, Settings → Notifications → Plate), then check again."
      >
        <Button variant="secondary" size="sm" onClick={onRecheck}>
          Check again
        </Button>
      </Notice>
    );
  }
  if (enrolled) {
    return (
      <Notice
        icon={BellRing}
        tone="success"
        title="Reminders are on for this device"
        description="A test shows what a reminder looks like here."
      >
        <Button variant="secondary" size="sm" onClick={onTest} loading={testing}>
          Send test notification
        </Button>
        <Button variant="outline" size="sm" onClick={onDisable} loading={busy}>
          Turn off on this device
        </Button>
      </Notice>
    );
  }
  return (
    <Notice
      icon={Bell}
      title="Get reminders on this device"
      description={
        status.permission === 'granted'
          ? 'Notifications are already allowed here; this just registers the device.'
          : 'Your browser asks for permission once.'
      }
    >
      <Button size="sm" onClick={onEnable} loading={busy}>
        Enable on this device
      </Button>
    </Notice>
  );
}

const UNSUPPORTED_COPY: Record<
  Extract<PushDeviceStatus, { kind: 'unsupported' }>['reason'],
  { icon: LucideIcon; title: string; description: string }
> = {
  insecure: {
    icon: Lock,
    title: 'Reminders need a secure connection',
    description: 'Open Plate over https:// (or on this machine) to enable notifications.',
  },
  'ios-not-installed': {
    icon: Smartphone,
    title: 'Add Plate to your Home Screen first',
    description:
      'On iPhone and iPad, notifications only reach the installed app: in Safari tap Share, then Add to Home Screen, open Plate from there and come back to this page.',
  },
  unsupported: {
    icon: BellOff,
    title: "This browser can't receive notifications",
    description: 'Use Chrome, Edge, Firefox or Safari 16.4+ (installed to the Home Screen on iOS).',
  },
  'no-worker': {
    icon: BellOff,
    title: "Plate's background worker is not running",
    description:
      'Reload the page and try again. Development builds have no service worker, so this is expected there.',
  },
};

function Notice({
  icon: Icon,
  tone = 'default',
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone?: 'default' | 'success';
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className={
          tone === 'success'
            ? 'bg-success/15 text-on-target-fg flex size-12 shrink-0 items-center justify-center rounded-2xl'
            : 'bg-accent-soft text-accent flex size-12 shrink-0 items-center justify-center rounded-2xl'
        }
      >
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-fg text-sm font-semibold">{title}</p>
        <p className="text-fg-muted mt-0.5 text-sm">{description}</p>
        {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  current,
  onRemove,
}: {
  device: PushSubscriptionInfo;
  current: boolean;
  onRemove: () => void;
}) {
  const added = formatDayShort(toDayKey(new Date(device.createdAt)));
  const last = device.lastUsedAt
    ? `last sent ${formatDayShort(toDayKey(new Date(device.lastUsedAt)))}`
    : 'nothing sent yet';
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <Smartphone className="text-fg-muted size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-fg truncate text-sm font-medium">{device.deviceLabel}</span>
          {current ? <Tag className="bg-accent-soft text-accent shrink-0">This device</Tag> : null}
        </div>
        <p className="text-fg-muted text-xs">
          Added {added} · {last}
          {device.failures > 0 ? (
            <>
              {' · '}
              <span className="text-danger">
                {device.failures} failed {device.failures === 1 ? 'delivery' : 'deliveries'}
              </span>
            </>
          ) : null}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={current ? 'Turn off reminders on this device' : `Remove ${device.deviceLabel}`}
        onClick={onRemove}
      >
        <Trash2 className="text-fg-muted size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}
