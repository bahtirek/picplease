/** Every string the page shows, from docs/mobile/ui-wording.md. Do not add text elsewhere. */
export const TEXT = {
  allowCameraBody: 'To take their photos, PicPlease needs your camera.',
  allowCameraButton: 'Allow camera',
  cameraDenied:
    'Camera access is off. Turn it on for this site in your browser settings, then reload.',
  cameraUnavailable: "This browser can't use the camera. Try another browser, or get the app.",
  codeUsed: 'This code was already used',
  codeInvalid: "This code isn't valid anymore",
  offline: 'No connection. You need to be online to help.',
  shutterLabel: 'Take photo',
  finish: 'Finish',
  sent: (n: number) => `${String(n)} sent`,
  sendingToast: 'Sending…',
  bufferFull: 'All 5 sending, one second…',
  keepOpen: 'Sending photo, please keep this open.',
  thanks: 'Thanks for helping!',
  ended: 'Session ended. Thanks for your help!',
  getApp: 'Get the app',
  appStore: 'App Store',
  googlePlay: 'Google Play',
} as const;
