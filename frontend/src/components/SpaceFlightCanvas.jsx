import { useEffect, useRef } from 'react';
import './SpaceFlightCanvas.css';

const SpaceFlightCanvas = ({ isWarping = false, isBoosting = false }) => {
  const canvasRef = useRef(null);
  const isWarpingRef = useRef(isWarping);
  const isBoostingRef = useRef(isBoosting);

  isWarpingRef.current = isWarping;
  isBoostingRef.current = isBoosting;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const NUM_STARS = 900;
    const MAX_DEPTH = 1600;
    const FOV = 320;
    const BASE_SPEED = 2.4;
    const BOOST_SPEED = 50;
    const WARP_SPEED = 74;

    let currentSpeed = BASE_SPEED;
    let throttle = 0;
    let currentTurbulence = 0;
    let targetSteerX = 0;
    let targetSteerY = 0;
    let steerX = 0;
    let steerY = 0;
    let lastTime = performance.now();

    const STAR_COLORS = [
      '#ffffff',
      '#ffffff',
      '#ffffff',
      '#e0f2fe',
      '#bae6fd',
      '#fef08a',
      '#fed7aa',
      '#e9d5ff',
    ];

    const stars = Array.from({ length: NUM_STARS }, () => {
      const z = Math.random() * MAX_DEPTH + 1;
      return {
        x: (Math.random() - 0.5) * width * 3.4,
        y: (Math.random() - 0.5) * height * 3.4,
        z,
        pz: z,
        size: Math.random() * 1.8 + 0.8,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        brightness: Math.random() * 0.4 + 0.6,
      };
    });

    const DUST_COUNT = 30;
    const dustParticles = Array.from({ length: DUST_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 1,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.3 + 0.1,
    }));

    const onMouseMove = (e) => {
      const normX = (e.clientX - width / 2) / (width / 2);
      const normY = (e.clientY - height / 2) / (height / 2);
      targetSteerX = normX * 130;
      targetSteerY = normY * 85;
    };
    window.addEventListener('mousemove', onMouseMove);

    const render = (now = performance.now()) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const warping = isWarpingRef.current;
      const boosting = isBoostingRef.current;

      steerX += (targetSteerX - steerX) * 0.05;
      steerY += (targetSteerY - steerY) * 0.05;

      if (boosting || warping) {
        const spoolRate = warping ? 0.68 : 0.45;
        throttle = Math.min(1, throttle + dt * spoolRate);
      } else {
        throttle = Math.max(0, throttle - dt * 0.55);
      }

      const thrustPower = throttle * throttle * (3 - 2 * throttle);

      const maxSpeed = warping ? WARP_SPEED : BOOST_SPEED;
      const targetSpeed = BASE_SPEED + (maxSpeed - BASE_SPEED) * thrustPower;
      currentSpeed += (targetSpeed - currentSpeed) * (warping ? 0.09 : 0.06);

      const targetTurbulence = Math.pow(throttle, 1.8);
      currentTurbulence += (targetTurbulence - currentTurbulence) * (boosting || warping ? 0.07 : 0.08);

      const loginContainer = canvas.closest('.login-container');
      if (loginContainer) {
        loginContainer.style.setProperty('--rocket-thrust', currentTurbulence.toFixed(3));
      }

      const shakeMag = currentTurbulence * 13;
      const shakeX = (Math.random() - 0.5) * shakeMag;
      const shakeY = (Math.random() - 0.5) * shakeMag;

      const cx = width / 2 - steerX * 0.4 + shakeX;
      const cy = height / 2 - steerY * 0.4 + shakeY;

      const trailAlpha = Math.max(0.18, 0.58 - thrustPower * 0.38);
      ctx.fillStyle = `rgba(2, 4, 10, ${trailAlpha})`;
      ctx.fillRect(0, 0, width, height);

      const nebulaGrad = ctx.createRadialGradient(
        cx + steerX * 0.15,
        cy + steerY * 0.15,
        40,
        cx,
        cy,
        Math.max(width, height) * 0.75
      );
      nebulaGrad.addColorStop(0, 'rgba(30, 27, 75, 0.2)');
      nebulaGrad.addColorStop(0.35, 'rgba(15, 23, 42, 0.12)');
      nebulaGrad.addColorStop(0.7, 'rgba(13, 148, 136, 0.04)');
      nebulaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = nebulaGrad;
      ctx.fillRect(0, 0, width, height);

      if (warping && thrustPower > 0.35) {
        const warpTunnelAlpha = (thrustPower - 0.35) * 0.32;
        const warpGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(width, height) * 0.7);
        warpGrad.addColorStop(0, `rgba(56, 189, 248, ${warpTunnelAlpha * 0.35})`);
        warpGrad.addColorStop(0.45, `rgba(99, 102, 241, ${warpTunnelAlpha * 0.2})`);
        warpGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = warpGrad;
        ctx.fillRect(0, 0, width, height);
      }

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        star.pz = star.z;
        star.z -= currentSpeed;

        if (star.z <= 0) {
          star.z = MAX_DEPTH;
          star.pz = MAX_DEPTH;
          star.x = (Math.random() - 0.5) * width * 3.4;
          star.y = (Math.random() - 0.5) * height * 3.4;
          continue;
        }

        const k = FOV / star.z;
        const sx = cx + star.x * k;
        const sy = cy + star.y * k;

        if (sx < -80 || sx > width + 80 || sy < -80 || sy > height + 80) {
          star.z = MAX_DEPTH;
          star.pz = MAX_DEPTH;
          star.x = (Math.random() - 0.5) * width * 3.4;
          star.y = (Math.random() - 0.5) * height * 3.4;
          continue;
        }

        const pk = FOV / star.pz;
        const px = cx + star.x * pk;
        const py = cy + star.y * pk;

        const depthRatio = 1 - star.z / MAX_DEPTH;
        const alpha = Math.min(1, depthRatio * 1.5 * star.brightness);
        const streakWidth = Math.max(0.75, depthRatio * star.size * (1 + currentTurbulence * 1.1));

        ctx.strokeStyle = star.color;
        ctx.lineWidth = streakWidth;
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        if (depthRatio > 0.65) {
          ctx.fillStyle = star.color;
          ctx.beginPath();
          ctx.arc(sx, sy, streakWidth * 1.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.fillStyle = 'rgba(224, 242, 254, 0.45)';
      for (let i = 0; i < dustParticles.length; i++) {
        const p = dustParticles[i];
        p.x += p.speedX - steerX * 0.006 + (Math.random() - 0.5) * currentTurbulence * 2;
        p.y += p.speedY - steerY * 0.006 + (Math.random() - 0.5) * currentTurbulence * 2;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <div className={`space-flight-container ${isBoosting ? 'is-boosting' : ''} ${isWarping ? 'is-warping' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="space-flight-canvas" />

      <div className="cockpit-canopy-vignette" />
      <div className="cockpit-canopy-struts" />
    </div>
  );
};

export default SpaceFlightCanvas;
