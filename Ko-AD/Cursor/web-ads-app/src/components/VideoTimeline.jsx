import { useEffect, useRef, useState, useMemo } from 'react';
import { useWaveform } from '../hooks/useWaveform';
import { useThumbnails, THUMB_WIDTH, THUMB_HEIGHT } from '../hooks/useThumbnails';
import './VideoTimeline.css';

/**
 * Professional NLE-style video timeline component
 * 
 * @param {Object} props
 * @param {string} props.videoSrc - URL of the video source
 * @param {number} props.duration - Duration of the video in seconds
 * @param {number} props.currentTime - Current playback time in seconds
 * @param {Function} props.onSeek - Callback when user seeks to a new time (timeInSeconds: number) => void
 */
// Track height constant - controls the height of both audio and video tracks
// This ensures both tracks have the same visual height in the timeline
const TRACK_HEIGHT = 80; // pixels

// Waveform scale factor - controls the visual amplitude of the waveform
// Range: 0.0 to 1.0 (default: 1.0)
// - 0.5 = waveform uses 50% of available height (more subtle)
// - 1.0 = waveform uses full available height (default, loudest part fills track)
// Adjust this value to make the waveform appear smaller or larger
const WAVEFORM_SCALE = 1.0; // Default: 1.0 (100% of available height)

export default function VideoTimeline({ videoSrc, adAudioSrc, duration, currentTime, onSeek }) {
  const timelineRef = useRef(null);
  const rowRef = useRef(null); // Ref for the timeline row (audio track row)
  const gutterRef = useRef(null); // Ref for the icon gutter area
  const trackRef = useRef(null); // Ref for the track-area (waveform/thumbnail container, excluding icon gutter)
  const waveformCanvasRef = useRef(null);
  const waveformContainerRef = useRef(null);

  // AD Track refs
  const adWaveformCanvasRef = useRef(null);
  const adWaveformContainerRef = useRef(null);

  const [trackWidth, setTrackWidth] = useState(0); // Single source of truth: width of track-area (excluding gutter)
  const [trackHeight, setTrackHeight] = useState(TRACK_HEIGHT); // Measured track height
  const [zoom, setZoom] = useState(1);
  const iconAreaWidth = 64;

  // Generate waveform and thumbnails
  // Thumbnails are generated based on trackWidth to ensure dense, gapless layout
  const { waveformData, loading: waveformLoading, error: waveformError } = useWaveform(videoSrc, duration, 2000);

  // Generate AD waveform
  // Only fetch if adAudioSrc is present
  const { waveformData: adWaveformData, loading: adWaveformLoading, error: adWaveformError } = useWaveform(adAudioSrc, duration, 2000);

  const { thumbnails, loading: thumbnailsLoading } = useThumbnails(videoSrc, duration, trackWidth);

  // UNIFIED TIME ↔ X MAPPING FUNCTIONS
  // 
  // These two functions are mathematically inverse:
  //   xToTime(timeToX(t, d, w), d, w) == t
  //   timeToX(xToTime(x, d, w), d, w) == x
  // 
  // They use the SAME width parameter and are used consistently for:
  // - waveform drawing
  // - thumbnail placement
  // - playhead position
  // - click-to-seek conversion
  // 
  // FIX FOR: "0sec click jumps to middle time" and "waveform cut off at end" bugs
  // 
  // Problem: Previous implementation used (width - 1) which broke the inverse relationship,
  // causing clicks at the left edge to map to wrong times, and waveform to not reach the end.
  // 
  // Solution: Use exact width for both functions, ensuring:
  //   - time 0 → x = 0 (left edge)
  //   - time duration → x = width (right edge)
  //   - x = 0 → time = 0
  //   - x = width → time = duration

  // Convert time to X position
  // X is local coordinate inside the track content area (after subtracting left padding)
  function timeToX(timeSec, duration, width) {
    if (width <= 0 || duration <= 0) return 0;
    const clampedTime = Math.min(Math.max(timeSec, 0), duration);
    const ratio = clampedTime / duration;
    return ratio * width;
  }

  // Convert X position to time
  // X is local coordinate inside the track content area (after subtracting left padding)
  function xToTime(x, duration, width) {
    if (width <= 0 || duration <= 0) return 0;
    const clampedX = Math.min(Math.max(x, 0), width); // 0..width
    const ratio = clampedX / width;
    return ratio * duration;
  }

  // Measure trackWidth from the track-area (excluding icon gutter) using ResizeObserver
  // 
  // FIX FOR: "Click at 0sec jumps to offset time" and "waveform cut off at end" bugs
  // 
  // Problem: The clickable time range was including the icon gutter, causing clicks at the
  // left edge of the waveform to map to non-zero times. Also, width measurement from parent
  // containers caused inconsistencies between Cursor in-app and external browsers.
  // 
  // Solution: Measure the EXACT track-area width (waveform/thumbnail container) that excludes
  // the icon gutter. This width is used for ALL time↔x mappings, ensuring:
  //   - Click at left edge of waveform → time = 0
  //   - Click at right edge → time = duration
  //   - Waveform and thumbnails span exactly from 0 to duration
  // 
  // trackRef MUST point to the <div> that starts right after the icon gutter
  // and covers only the waveform/thumbnail area.
  useEffect(() => {
    const container = trackRef.current;
    if (!container) return;

    // Initial measurement
    const measureWidth = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      if (width > 0) {
        setTrackWidth(width);
        // Debug logs (can be re-enabled for debugging)
        if (process.env.NODE_ENV === 'development') {
          console.log('[VideoTimeline] Measured trackWidth:', {
            trackAreaRect: { width: rect.width, height: rect.height },
            trackWidth: width
          });
        }
      }
    };

    // Measure on mount
    measureWidth();

    // Use ResizeObserver to react to size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setTrackWidth(width);
          // Debug logs (can be re-enabled for debugging)
          if (process.env.NODE_ENV === 'development') {
            console.log('[VideoTimeline] trackWidth changed:', {
              contentRect: { width: entry.contentRect.width, height: entry.contentRect.height },
              trackWidth: width
            });
          }
        }
      }
    });

    resizeObserver.observe(container);

    // Fallback: also listen to window resize for older browsers
    window.addEventListener('resize', measureWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measureWidth);
    };
  }, []);

  // Debug: Log gutter vs track vs row widths to verify trackWidth is correct
  // This helps identify if any code is still using rowWidth or other incorrect widths
  useEffect(() => {
    if (!rowRef.current || !gutterRef.current || !trackRef.current) return;

    const rowRect = rowRef.current.getBoundingClientRect();
    const gutterRect = gutterRef.current.getBoundingClientRect();
    const trackRect = trackRef.current.getBoundingClientRect();

    // Debug logs (can be re-enabled for debugging)
    if (process.env.NODE_ENV === 'development') {
      console.log('[debug widths]', {
        rowWidth: rowRect.width,
        gutterWidth: gutterRect.width,
        trackWidth: trackRect.width,
        measuredTrackWidth: trackWidth, // State value from ResizeObserver
        rowMinusTrack: rowRect.width - trackRect.width,
        rowMinusGutter: rowRect.width - gutterRect.width,
        trackWidthMatchesRect: Math.abs(trackWidth - trackRect.width) < 1
      });
    }
  }, [trackWidth]); // Re-run when trackWidth changes

  // Measure track height using ResizeObserver for reactivity
  // This ensures the waveform scales correctly when the container size changes
  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container) return;

    // Initial measurement using getBoundingClientRect
    const measureHeight = () => {
      const rect = container.getBoundingClientRect();
      const measuredHeight = rect.height;
      if (measuredHeight > 0) {
        setTrackHeight(measuredHeight);
        console.log('[VideoTimeline] Measured track height:', measuredHeight, 'px');
      }
    };

    // Measure on mount
    measureHeight();

    // Use ResizeObserver to react to size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (height > 0) {
          setTrackHeight(height);
          console.log('[VideoTimeline] Track height changed:', height, 'px');
        }
      }
    });

    resizeObserver.observe(container);

    // Fallback: also listen to window resize
    window.addEventListener('resize', measureHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measureHeight);
    };
  }, []);

  // Helper function to draw waveform
  const drawWaveform = (canvas, data, width, height, color = '#4a90e2') => {
    if (!canvas || !data.length || !width || width <= 0 || height <= 0 || !duration || duration <= 0) {
      return;
    }

    const logicalWidth = width;
    const logicalHeight = height;

    const dpr = window.devicePixelRatio || 1;
    const canvasInternalWidth = logicalWidth * dpr;
    const canvasInternalHeight = logicalHeight * dpr;

    if (canvas.width !== canvasInternalWidth || canvas.height !== canvasInternalHeight) {
      canvas.width = canvasInternalWidth;
      canvas.height = canvasInternalHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const centerY = logicalHeight / 2;

    let globalMaxAbs = 0;
    data.forEach((peak) => {
      const absMin = Math.abs(peak.min);
      const absMax = Math.abs(peak.max);
      if (absMin > globalMaxAbs) globalMaxAbs = absMin;
      if (absMax > globalMaxAbs) globalMaxAbs = absMax;
    });

    const normalizeFactor = globalMaxAbs > 0 ? globalMaxAbs : 1;
    const maxBarHeight = logicalHeight * 0.9 * WAVEFORM_SCALE;

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    data.forEach((peak, index) => {
      const denominator = data.length > 1 ? data.length - 1 : 1;
      const peakTime = (index / denominator) * duration;
      const x = timeToX(peakTime, duration, logicalWidth);

      const normalizedMin = peak.min / normalizeFactor;
      const normalizedMax = peak.max / normalizeFactor;
      const normalized = Math.max(Math.abs(normalizedMin), Math.abs(normalizedMax));
      const barHeight = normalized * maxBarHeight;

      const topY = centerY - barHeight / 2;
      const bottomY = centerY + barHeight / 2;

      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.stroke();
    });
  };

  // Draw original waveform
  useEffect(() => {
    drawWaveform(waveformCanvasRef.current, waveformData, trackWidth, trackHeight, '#4a90e2');
  }, [waveformData, trackWidth, trackHeight, duration]);

  // Draw AD waveform
  useEffect(() => {
    if (adAudioSrc && adWaveformData.length > 0) {
      drawWaveform(adWaveformCanvasRef.current, adWaveformData, trackWidth, trackHeight, '#e24a90'); // Different color for AD
    }
  }, [adWaveformData, trackWidth, trackHeight, duration, adAudioSrc]);

  // Format timecode: H:MM:SS:FF (assuming 30 fps)
  const formatTimecode = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  };

  // Handle track-area click
  // FIX FOR: "Click at 0sec jumps to offset time" bug
  // 
  // IMPORTANT: 
  // - localX must be computed from trackRef (the track-area div, excluding icon gutter)
  // - There must be NO additional offset or padding subtracted/added in this handler
  // - Do NOT use the outer container's rect that includes the icons
  // - Use the unified xToTime function with trackWidth to ensure consistency
  // - After this change, clicking at the very start of the track-area should give newTime ≈ 0
  const handleTrackClick = (e) => {
    if (!trackRef.current || trackWidth <= 0 || duration <= 0) return;

    const rect = trackRef.current.getBoundingClientRect();
    const localX = e.clientX - rect.left; // 0 at the left edge of the waveform/thumbnail area

    // Use unified xToTime function with trackWidth
    // This ensures click-to-seek uses the exact same mapping as waveform, thumbnails, and playhead
    const newTime = xToTime(localX, duration, trackWidth);

    // Debug logs (can be re-enabled for debugging)
    if (process.env.NODE_ENV === 'development') {
      console.log('[click]', {
        clientX: e.clientX,
        rectLeft: rect.left,
        localX: localX,
        rectWidth: rect.width,
        trackWidth: trackWidth,
        rectWidthMatchesTrackWidth: Math.abs(rect.width - trackWidth) < 1,
        newTime: newTime
      });
    }

    onSeek(newTime);
  };

  // Generate time markers for ruler
  const timeMarkers = useMemo(() => {
    if (duration <= 0) return [];
    const markers = [];
    const interval = duration > 180 ? 30 : duration > 60 ? 10 : 5; // Adjust interval based on duration

    for (let time = 0; time <= duration; time += interval) {
      markers.push(time);
    }
    if (markers[markers.length - 1] !== duration) {
      markers.push(duration);
    }
    return markers;
  }, [duration]);

  // Calculate playhead position using shared timeToX function
  // The playhead is positioned relative to the timeline board
  // We use trackWidth for time-to-x mapping, then add iconAreaWidth for absolute position
  const playheadX = useMemo(() => {
    if (duration <= 0 || trackWidth <= 0) return iconAreaWidth;
    // Use shared timeToX function with trackWidth to get x position in track area
    const trackX = timeToX(currentTime, duration, trackWidth);
    // Add iconAreaWidth to get absolute position relative to timeline board
    return iconAreaWidth + trackX;
  }, [currentTime, duration, trackWidth]);

  return (
    <div className="videoTimeline">
      {/* Timeline Board */}
      <div className="videoTimeline__board" ref={timelineRef}>
        {/* Time Ruler */}
        {/* Uses shared timeToX function for consistent time mapping */}
        <div className="videoTimeline__ruler">
          {timeMarkers.map((time) => {
            // Use shared timeToX function with trackWidth to get x position in track area
            const trackX = timeToX(time, duration, trackWidth);
            // Add iconAreaWidth to get absolute position relative to timeline board
            const markerX = iconAreaWidth + trackX;
            return (
              <div
                key={time}
                className="videoTimeline__marker"
                style={{ left: `${markerX}px` }}
              >
                {formatTimecode(time)}
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="videoTimeline__playhead"
          style={{ left: `${playheadX}px` }}
        />

        {/* Tracks */}
        <div className="videoTimeline__tracks">
          {/* Audio Track */}
          {/* rowRef: The entire timeline row (gutter + track area) */}
          <div className="videoTimeline__track videoTimeline__track--audio" ref={rowRef}>
            {/* Gutter: Icon area - NOT part of clickable time range */}
            {/* gutterRef: The icon gutter area */}
            <div className="videoTimeline__trackIcon" ref={gutterRef}>♪</div>
            {/* Track Area: Waveform/thumbnail area - clickable time range starts here */}
            {/* trackRef MUST point to this div that starts right after the icon gutter */}
            <div
              ref={(el) => {
                waveformContainerRef.current = el;
                trackRef.current = el; // Use waveform container as trackRef (same width as thumbnail container)
              }}
              className="videoTimeline__waveformContainer"
              onClick={handleTrackClick}
            >
              {waveformLoading ? (
                <div className="videoTimeline__loading">Loading waveform...</div>
              ) : waveformError ? (
                <div className="videoTimeline__loading" style={{ color: '#ef4444' }}>
                  {waveformError}
                </div>
              ) : waveformData.length === 0 ? (
                <div className="videoTimeline__loading">No waveform data</div>
              ) : (
                <canvas
                  ref={waveformCanvasRef}
                  className="videoTimeline__waveform"
                  style={{
                    width: `${trackWidth}px`, // Use exact trackWidth to match measured track area
                    height: `${trackHeight}px`, // Use exact trackHeight measured via ResizeObserver
                    display: 'block'
                  }}
                />
              )}
            </div>
          </div>

          {/* AD Audio Track */}
          <div className="videoTimeline__track videoTimeline__track--ad">
            <div className="videoTimeline__trackIcon">AD</div>
            <div
              ref={adWaveformContainerRef}
              className="videoTimeline__waveformContainer"
              onClick={handleTrackClick}
            >
              {!adAudioSrc ? (
                <div className="videoTimeline__loading">No AD Audio</div>
              ) : adWaveformLoading ? (
                <div className="videoTimeline__loading">Loading AD...</div>
              ) : adWaveformError ? (
                <div className="videoTimeline__loading" style={{ color: '#ef4444' }}>
                  {adWaveformError}
                </div>
              ) : adWaveformData.length === 0 ? (
                <div className="videoTimeline__loading">No AD waveform data</div>
              ) : (
                <canvas
                  ref={adWaveformCanvasRef}
                  className="videoTimeline__waveform"
                  style={{
                    width: `${trackWidth}px`,
                    height: `${trackHeight}px`,
                    display: 'block'
                  }}
                />
              )}
            </div>
          </div>

          {/* Video Track */}
          <div className="videoTimeline__track videoTimeline__track--video">
            {/* Gutter: Icon area - NOT part of clickable time range */}
            <div className="videoTimeline__trackIcon">📹</div>
            {/* Track Area: Thumbnail area - clickable time range starts here */}
            <div
              className="videoTimeline__thumbnailsContainer"
              onClick={handleTrackClick}
            >
              {thumbnailsLoading ? (
                <div className="videoTimeline__loading">Loading thumbnails...</div>
              ) : (
                thumbnails.map((thumb) => {
                  // FIX FOR: "Large empty gaps between thumbnails" layout issue
                  // 
                  // Problem: Previous implementation positioned thumbnails by time → x,
                  // which left large empty gaps when the video was long or the track was wide.
                  // 
                  // Solution: Render thumbnails in a dense, gapless layout using flexbox.
                  // Each thumbnail is a fixed-width cell, and flexbox keeps them tightly packed.
                  // The order is based on slotIndex, not time-based positioning.

                  // Calculate vertical centering
                  // Track height is 80px, thumbnail height is 60px
                  // Center the thumbnail vertically: (80 - 60) / 2 = 10px from top
                  const topOffset = (trackHeight - THUMB_HEIGHT) / 2;

                  return (
                    <div
                      key={thumb.slotIndex}
                      className="videoTimeline__thumbnail"
                      style={{
                        width: `${THUMB_WIDTH}px`, // Fixed width - ensures dense layout
                        height: `${THUMB_HEIGHT}px`, // Fixed height
                        top: `${topOffset}px` // Center vertically in track
                      }}
                    >
                      <img
                        src={thumb.dataUrl}
                        alt={`Thumbnail at ${thumb.centerTime.toFixed(1)}s`}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover', // Keep aspect ratio, crop if needed
                          display: 'block'
                        }}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

