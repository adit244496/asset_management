const DECODE_MAX_EDGE = 640;

export function hasNativeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function cameraAvailability() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { ok: false, reason: 'unsupported', detail: 'There is no browser here.' };
  }
  if (navigator.mediaDevices?.getUserMedia) {
    return { ok: true, reason: null, detail: null };
  }
  if (window.isSecureContext === false) {
    return {
      ok: false,
      reason: 'insecure',
      detail: 'Browsers only allow camera access over https:// or on localhost, and this '
        + `page was opened over ${window.location.protocol}//. Open it at https://, or use `
        + 'the handheld scanner, which needs no camera.',
    };
  }
  return {
    ok: false,
    reason: 'unsupported',
    detail: 'This browser does not offer camera access. Chrome, Edge, Firefox and Safari '
      + 'all do.',
  };
}

export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser blocked access to the camera. Allow it for this site (the icon at '
        + 'the right-hand end of the address bar) and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Use the handheld scanner, or type the '
        + 'serial number.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera could not be started — another program is probably using it. Close '
        + 'Teams, Zoom or any other app holding the camera, then try again.';
    default:
      return `The camera could not be opened (${err?.name || 'unknown error'}).`;
  }
}

const INVERSION_CYCLE = ['dontInvert', 'onlyInvert'];

export function createFrameDecoder() {
  let native = null;
  let jsQRPromise = null;
  let canvas = null;
  let ctx = null;
  let frame = 0;

  if (hasNativeDetector()) {
    try {
      native = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      native = null;
    }
  }

  const loadJsQR = () => {
    if (!jsQRPromise) {
      jsQRPromise = import('../vendor/jsqr/jsQR.js').then((m) => m.default);
    }
    return jsQRPromise;
  };

  const grabPixels = (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));

    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };

  const decode = async (video) => {
    if (!video) return null;

    if (native) {
      const found = await native.detect(video);
      return found.length ? found[0].rawValue : null;
    }

    const pixels = grabPixels(video);
    if (!pixels) return null;
    const jsQR = await loadJsQR();
    frame += 1;
    const result = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: INVERSION_CYCLE[frame % INVERSION_CYCLE.length],
    });
    return result?.data || null;
  };

  const dispose = () => {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    canvas = null;
    ctx = null;
    native = null;
  };

  return { decode, dispose, usesNative: Boolean(native) };
}
