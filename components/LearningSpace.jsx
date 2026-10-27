'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import brandLogo from '@/public/kidz-morphix-logo.svg';

const HINTS = [
  { type: 'look', text: 'Click and drag to look around', icon: 'drag' },
  { type: 'move', text: 'Click on the floor to move around', icon: 'floor' },
  { type: 'material', text: 'Click furniture to focus on it and explore its finishes', icon: 'material' },
];

function Icon({ name }) {
  const common = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'drag') {
    return (
      <svg {...common}>
        <path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3" />
        <circle cx="12" cy="12" r="2.2" />
      </svg>
    );
  }
  if (name === 'floor') {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="16" rx="8" ry="3.2" />
        <circle cx="12" cy="16" r="0.8" fill="currentColor" />
        <path d="M12 4v8M9 9l3 3 3-3" />
      </svg>
    );
  }
  if (name === 'material') {
    return (
      <svg {...common}>
        <circle cx="7" cy="12" r="3" />
        <circle cx="17" cy="12" r="3" />
        <circle cx="12" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
      </svg>
    );
  }
  if (name === 'info') {
    return (
      <svg {...common} width={20} height={20}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.01" />
      </svg>
    );
  }
  if (name === 'fullscreen') {
    return (
      <svg {...common} width={20} height={20}>
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      </svg>
    );
  }
  if (name === 'back') return <svg {...common} width={18} height={18}><path d="M19 12H5m6-6-6 6 6 6" /></svg>;
  if (name === 'reset') return <svg {...common} width={20} height={20}><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></svg>;
  if (name === 'play') return <svg {...common} width={20} height={20}><path d="m9 5 10 7-10 7Z" /></svg>;
  if (name === 'pause') return <svg {...common} width={20} height={20}><path d="M9 5v14M15 5v14" /></svg>;
  if (name === 'plus' || name === 'minus') return <svg {...common} width={20} height={20}><path d="M5 12h14" />{name === 'plus' && <path d="M12 5v14" />}</svg>;
  if (name === 'left' || name === 'right') return <svg {...common} width={20} height={20}><path d={name === 'left' ? 'm14 5-7 7 7 7' : 'm10 5 7 7-7 7'} /></svg>;
  return (
    <svg {...common} width={18} height={18}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function FinishPalette({ palette, hoveredSwatch, onHover, onApply, onClose, onPart, inspecting = false }) {
  if (!palette) return null;
  const name = hoveredSwatch ?? palette.options[palette.active]?.name;
  return (
    <div className="palette" aria-label="Item finishes">
      {inspecting && palette.parts.length > 1 && (
        <div className="finish-parts" aria-label="Choose a part">
          {palette.parts.map((part) => (
            <button key={part.id} aria-pressed={palette.part === part.id} onClick={() => onPart(part.id)}>{part.label}</button>
          ))}
        </div>
      )}
      <div className="palette-head">
        <span className="palette-label">{palette.label}</span>
        <span className="palette-name">{name}</span>
        {!inspecting && <button className="palette-close" aria-label="Close finishes" onClick={onClose}><Icon name="close" /></button>}
      </div>
      <div className="swatches">
        {palette.options.map((option, index) => (
          <button
            key={option.name}
            className={`swatch ${index === palette.active ? 'active' : ''}`}
            style={{ background: option.swatch ?? option.color }}
            aria-label={option.name}
            aria-pressed={index === palette.active}
            title={option.name}
            onClick={() => onApply(index)}
            onMouseEnter={() => onHover(option.name)}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </div>
    </div>
  );
}

export default function LearningSpace() {
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [phase, setPhase] = useState('loading'); // loading → ready → inside
  const [progress, setProgress] = useState(0);
  const [shownProgress, setShownProgress] = useState(0);
  const [done, setDone] = useState(() => new Set());
  const [palette, setPalette] = useState(null);
  const [hoveredSwatch, setHoveredSwatch] = useState(null);
  const [about, setAbout] = useState(false);
  const [inspection, setInspection] = useState(null);
  const inspectionRef = useRef(null);

  useEffect(() => {
    let viewer;
    let cancelled = false;

    setProgress(0.25);
    // Three.js touches window/WebGL, so load it only in the browser.
    import('@/lib/viewer').then(async ({ createViewer }) => {
      if (cancelled) return;
      setProgress(0.6);
      viewer = createViewer(canvasRef.current, {
        onSelect: (p) => {
          setPalette(p);
          setHoveredSwatch(null);
        },
        onInteract: (type) => setDone((d) => (d.has(type) ? d : new Set(d).add(type))),
        onInspect: setInspection,
      });
      viewerRef.current = viewer;
      await viewer.ready;
      if (!cancelled) setProgress(1);
    });

    return () => {
      cancelled = true;
      viewer?.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inspection?.id) return;
    const panel = inspectionRef.current;
    panel?.querySelector('button')?.focus();
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const buttons = [...panel.querySelectorAll('button')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!panel.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      canvasRef.current?.focus({ preventScroll: true });
    };
  }, [inspection?.id]);

  // Count the percentage up smoothly rather than jumping between stages.
  useEffect(() => {
    if (shownProgress >= progress) {
      if (progress === 1 && phase === 'loading') setPhase('ready');
      return;
    }
    // Time-based so a slow first few frames don't stall the counter.
    const from = performance.now();
    const id = requestAnimationFrame(() =>
      setShownProgress((p) => Math.min(progress, p + Math.max(0.01, (performance.now() - from) / 1000) * 1.5))
    );
    return () => cancelAnimationFrame(id);
  }, [shownProgress, progress, phase]);

  const enter = () => {
    viewerRef.current?.enter();
    setPhase('inside');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  // Show the first hint the visitor hasn't tried yet.
  const hint = HINTS.findIndex((h) => !done.has(h.type));
  const currentHint = HINTS[hint];
  const finishPalette = (
    <FinishPalette palette={palette} hoveredSwatch={hoveredSwatch} onHover={setHoveredSwatch}
      onApply={(index) => viewerRef.current?.applyOption(index)}
      onPart={(id) => { setHoveredSwatch(null); viewerRef.current?.selectPart(id); }}
      onClose={() => viewerRef.current?.closePalette()} inspecting={!!inspection} />
  );

  return (
    <main className={`experience phase-${phase}${inspection ? ' is-inspecting' : ''}`}>
      <canvas ref={canvasRef} className="scene" tabIndex={0} aria-label={inspection ? `${inspection.label} highlighted in the learning commons` : 'Interactive learning commons'} />

      {/* Landing */}
      <section className="landing" aria-hidden={phase === 'inside'}>
        <div className="landing-inner">
          <Image className="brand-logo landing-logo" src={brandLogo} alt="Kidz Morphix" loading="eager" unoptimized />
          <h1>We create learning spaces.</h1>
          <p className="lede">
            Step inside an open learning commons: no closed classrooms, just connected zones flowing
            from the garden glazing to a reading pit, library pods, an early-years studio, a movement
            room and a dining commons.
          </p>
          <div className="landing-action">
            {phase === 'loading' ? (
              <div className="loader">
                <span>Loading</span>
                <span className="loader-value">{Math.round(shownProgress * 100)}%</span>
                <div className="loader-bar">
                  <div style={{ transform: `scaleX(${shownProgress})` }} />
                </div>
              </div>
            ) : (
              <button className="enter" onClick={enter}>
                Enter the commons
              </button>
            )}
          </div>
          <button className="more-info" onClick={() => setAbout(true)}>
            More info
          </button>
        </div>
      </section>

      {/* Inside */}
      <header className="topbar" inert={!!inspection}>
        <Image className="brand-logo header-logo" src={brandLogo} alt="Kidz Morphix" loading="eager" unoptimized />
        <div className="topbar-actions">
          <button aria-label="About" onClick={() => setAbout(true)}>
            <Icon name="info" />
          </button>
          <button aria-label="Toggle fullscreen" onClick={toggleFullscreen}>
            <Icon name="fullscreen" />
          </button>
        </div>
      </header>

      {currentHint && !palette && !inspection && (
        // The first hint waits for the entry glide to finish.
        <div className="hint" key={hint} style={{ animationDelay: hint === 0 ? '3.2s' : '0.5s' }}>
          <Icon name={currentHint.icon} />
          <span>{currentHint.text}</span>
        </div>
      )}

      {!inspection && finishPalette}

      {inspection && (
        <section ref={inspectionRef} className="inspection-ui" role="dialog" aria-modal="true" aria-labelledby="inspection-title" aria-describedby="inspection-help">
          <div className="inspection-topbar">
            <button className="inspection-back" onClick={() => viewerRef.current?.closeInspection()}><Icon name="back" /> Resume exploring</button>
            <Image className="brand-logo header-logo" src={brandLogo} alt="Kidz Morphix" unoptimized />
          </div>
          <div className="inspection-heading">
            <p className="eyebrow">Selected item</p>
            <h2 id="inspection-title">{inspection.label}</h2>
          </div>
          <div className="inspection-bottom">
            <div className="inspection-tools" role="group" aria-label="360 view controls">
              <button aria-label="Rotate left" title="Rotate left" onClick={() => viewerRef.current?.orbitInspection(-Math.PI / 4)}><Icon name="left" /></button>
              <button aria-label={inspection.rotating ? 'Pause rotation' : 'Auto rotate'} aria-pressed={inspection.rotating} title={inspection.rotating ? 'Pause rotation' : 'Auto rotate'} onClick={() => viewerRef.current?.rotateInspection()}><Icon name={inspection.rotating ? 'pause' : 'play'} /></button>
              <button aria-label="Rotate right" title="Rotate right" onClick={() => viewerRef.current?.orbitInspection(Math.PI / 4)}><Icon name="right" /></button>
              <span className="inspection-divider" />
              <button aria-label="Zoom out" title="Zoom out" onClick={() => viewerRef.current?.zoomInspection(1.15)}><Icon name="minus" /></button>
              <button aria-label="Zoom in" title="Zoom in" onClick={() => viewerRef.current?.zoomInspection(0.85)}><Icon name="plus" /></button>
              <button aria-label="Reset view" title="Reset view" onClick={() => viewerRef.current?.resetInspection()}><Icon name="reset" /></button>
            </div>
            <p id="inspection-help" className="inspection-help">Drag to look around this item · Scroll or pinch to zoom</p>
            {finishPalette}
          </div>
        </section>
      )}

      {about && (
        <div className="about" onClick={() => setAbout(false)}>
          <div className="about-card" onClick={(e) => e.stopPropagation()}>
            <button className="palette-close" aria-label="Close" onClick={() => setAbout(false)}>
              <Icon name="close" />
            </button>
            <p className="eyebrow">About</p>
            <h2>An open learning commons</h2>
            <p>
              Space is the third teacher. Instead of closed classrooms, one open floor is zoned around the
              Enriched Environment Model™: curved shapes, flexible furniture, visual connection, space to move
              and optimised natural light. Walk from the reading pit to the library pods, the early-years
              studio, the movement room and the dining commons.
            </p>
            <ul>
              <li><b>Look</b> — click and drag anywhere.</li>
              <li><b>Move</b> — click a spot on the floor to glide there.</li>
              <li><b>Customise</b> — click the pit, pods, benches, bean bags, chairs, tables, nooks, rings, counters, panels or walls to pick a new finish.</li>
              <li><b>Inspect</b> — click furniture or the interactive display to focus on it in the room. The selected item is highlighted while its surroundings stay visible. Drag to orbit, scroll or pinch to zoom, then choose Resume exploring or press Escape.</li>
              <li><b>Zoom</b> — scroll to narrow the field of view.</li>
            </ul>
          </div>
        </div>
      )}
    </main>
  );
}
