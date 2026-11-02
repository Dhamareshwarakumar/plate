/**
 * How to re-enable the camera after a denied prompt, per browser. Browsers never re-ask once the
 * user said no (Safari re-asks only after a reload), so the sheet has to say where the switch is.
 */
export function cameraPermissionHelp(
  userAgent: string = navigator.userAgent,
  standalone: boolean = typeof matchMedia === 'function' &&
    matchMedia('(display-mode: standalone)').matches,
): string {
  const ua = userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const android = /Android/.test(ua);
  const firefox = /Firefox\//.test(ua) && !/Seamonkey/.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\//.test(ua);

  if (ios) {
    return standalone
      ? 'Open the iPhone Settings app, find Plate (or Safari → Camera), set Camera to Allow, then try again.'
      : 'In Safari, tap the page settings (“aA”) button in the address bar → Website Settings → Camera → Allow, then try again.';
  }
  if (android) {
    return standalone
      ? 'Open Android Settings → Apps → Plate → Permissions → Camera → Allow, then try again.'
      : 'Tap the lock icon next to the address → Permissions → Camera → Allow, then try again.';
  }
  if (firefox) {
    return 'Click the camera icon in the address bar, clear the blocked permission, then try again.';
  }
  if (safari) {
    return 'In Safari, open Settings for This Website (Safari menu) and set Camera to Allow, then try again.';
  }
  return 'Click the camera or site-information icon in the address bar, allow Camera for this site, then try again.';
}
