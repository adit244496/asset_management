import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';
import { cameraErrorMessage, createFrameDecoder } from '../lib/qrDecode';
import './QrScanner.css';

const DECODE_INTERVAL_MS = 100;

const QrScanner = ({ onResult, onCancel }) => {
  const videoRef = useRef(null);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const listCameras = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    const decoder = createFrameDecoder();
    const video = videoRef.current;
    let stream = null;
    let timer = null;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        const text = await decoder.decode(video);
        if (text && !stopped) {
          stopped = true;
          navigator.vibrate?.(60);
          onResultRef.current?.(text);
          return;
        }
      } catch {
      }
      if (!stopped) timer = setTimeout(tick, DECODE_INTERVAL_MS);
    };

    navigator.mediaDevices
      .getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' } },
      })
      .then((granted) => {
        if (stopped || !video) {
          granted.getTracks().forEach((t) => t.stop());
          return undefined;
        }
        stream = granted;
        setActiveId(granted.getVideoTracks()[0]?.getSettings?.()?.deviceId || null);
        listCameras();
        video.srcObject = granted;
        video.onloadeddata = () => setReady(true);
        video.play().catch(() => {  });
        tick();
        return undefined;
      })
      .catch((err) => {
        if (!stopped) setError(cameraErrorMessage(err));
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      decoder.dispose();
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [deviceId, listCameras]);

  const switchCamera = () => {
    if (devices.length < 2) return;
    const current = devices.findIndex((d) => d.deviceId === (deviceId || activeId));
    const next = devices[(Math.max(current, 0) + 1) % devices.length];
    setReady(false);
    setError(null);
    setDeviceId(next.deviceId);
  };

  return (
    <div className="qr-scanner">
      <div className="qr-scanner-stage">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} muted playsInline />

        {ready && !error && <div className="qr-scanner-frame" aria-hidden="true" />}

        {!ready && !error && (
          <div className="qr-scanner-overlay">
            <Camera size={20} />
            <span>Starting the camera&hellip;</span>
          </div>
        )}

        {error && (
          <div className="qr-scanner-overlay qr-scanner-overlay-error">
            <span>{error}</span>
          </div>
        )}

        <div className="qr-scanner-bar">
          <span className="qr-scanner-hint">
            {error ? 'Camera unavailable' : 'Point the camera at the QR label'}
          </span>
          {devices.length > 1 && !error && (
            <button
              type="button"
              className="qr-scanner-btn"
              onClick={switchCamera}
              title="Switch camera"
            >
              <RefreshCw size={14} /> Switch
            </button>
          )}
          <button type="button" className="qr-scanner-btn" onClick={onCancel} title="Stop">
            <X size={14} /> Stop
          </button>
        </div>
      </div>
    </div>
  );
};

export default QrScanner;
