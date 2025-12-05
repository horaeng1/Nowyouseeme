import { useEffect, useState, useRef } from 'react';

/**
 * Hook to generate video thumbnails at regular intervals
 * 
 * FIX FOR: "Blurry smeared thumbnails at the beginning" quality bug
 * 
 * Problem: Thumbnails at the beginning looked blurry because:
 * - Canvas size was too small and later stretched in CSS
 * - devicePixelRatio was not considered
 * - imageSmoothingEnabled was not controlled
 * 
 * Solution: Generate thumbnails at near-display resolution with proper scaling
 * 
 * @param {string} videoSrc - URL of the video source
 * @param {number} duration - Duration of the video in seconds
 * @param {number} interval - Interval between thumbnails in seconds (default: 5)
 * @returns {Object} { thumbnails, loading, error }
 *   - thumbnails: Array of { time, dataUrl } objects
 *   - loading: Boolean indicating if thumbnails are being generated
 *   - error: Error message if generation failed
 */

// Thumbnail resolution constants
// These define the target size for each thumbnail image
// The off-screen canvas size must match these values (with devicePixelRatio scaling)
// to avoid blur when images are displayed
export const THUMB_WIDTH = 40; // Fixed thumbnail cell width in CSS pixels
export const THUMB_HEIGHT = 60; // Fixed thumbnail cell height in CSS pixels

/**
 * Hook to generate video thumbnails in a dense, gapless layout
 * 
 * FIX FOR: "Large empty gaps between thumbnails" layout issue
 * 
 * Problem: Previous implementation generated thumbnails at fixed time intervals,
 * which left large empty gaps when the video was long or the track was wide.
 * 
 * Solution: Generate thumbnails based on track width, ensuring the strip is
 * visually dense with no empty gaps. Each thumbnail represents a time segment,
 * and thumbnails are laid out using flexbox to fill the entire track width.
 * 
 * @param {string} videoSrc - URL of the video source
 * @param {number} duration - Duration of the video in seconds
 * @param {number} trackWidth - Width of the track area in CSS pixels
 * @returns {Object} { thumbnails, loading, error }
 *   - thumbnails: Array of { slotIndex, centerTime, dataUrl } objects
 *   - loading: Boolean indicating if thumbnails are being generated
 *   - error: Error message if generation failed
 */
export function useThumbnails(videoSrc, duration, trackWidth) {
  const [thumbnails, setThumbnails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!videoSrc || !duration || duration <= 0 || !trackWidth || trackWidth <= 0) {
      setThumbnails([]);
      return;
    }

    let cancelled = false;

    const generateThumbnails = async () => {
      setLoading(true);
      setError(null);

      try {
        // Create off-screen video element
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = videoSrc;
        video.muted = true;
        video.preload = 'auto';
        videoRef.current = video;

        // Wait for video to be ready
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = () => {
            if (cancelled) return;
            resolve();
          };
          video.onerror = reject;
          video.load();
        });

        if (cancelled) return;

        // Create off-screen canvas at target thumbnail size
        // The canvas internal size must match the target size (with devicePixelRatio)
        // to avoid blur when images are displayed
        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        
        // Canvas internal size = target size * devicePixelRatio for crisp rendering
        canvas.width = THUMB_WIDTH * dpr;
        canvas.height = THUMB_HEIGHT * dpr;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }
        
        // Set transform to match devicePixelRatio
        // After setTransform, coordinates are in CSS pixels (THUMB_WIDTH x THUMB_HEIGHT)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        // Disable image smoothing to avoid blur when scaling
        // This ensures crisp thumbnails, especially when upscaling
        ctx.imageSmoothingEnabled = false;
        
        canvasRef.current = canvas;

        // Debug logs (can be re-enabled for debugging)
        if (process.env.NODE_ENV === 'development') {
          console.log('[thumb-gen] Canvas setup:', {
            targetWidth: THUMB_WIDTH,
            targetHeight: THUMB_HEIGHT,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            dpr,
            imageSmoothingEnabled: ctx.imageSmoothingEnabled
          });
        }

        // Compute number of thumbnail slots based on track width
        // This ensures thumbnails fill the entire track width with no gaps
        // slots: number of thumbnail cells needed to cover trackWidth
        const slots = Math.max(1, Math.ceil(trackWidth / THUMB_WIDTH));
        
        // segmentDuration: duration of video represented by each thumbnail slot
        // Each slot represents a continuous time segment of the video
        const segmentDuration = duration / slots;

        // Debug logs (can be re-enabled for debugging)
        if (process.env.NODE_ENV === 'development') {
          console.log('[thumb-gen] Layout calculation:', {
            trackWidth,
            THUMB_WIDTH,
            slots,
            segmentDuration,
            totalThumbnailWidth: slots * THUMB_WIDTH
          });
        }

        const generatedThumbnails = [];

        // Generate one thumbnail per slot
        // For each slotIndex in [0 .. slots - 1]:
        for (let slotIndex = 0; slotIndex < slots; slotIndex++) {
          if (cancelled) break;

          // Calculate center time for this slot
          // thumbCenterTime = (slotIndex + 0.5) * segmentDuration
          // This places the thumbnail at the center of its time segment
          const thumbCenterTime = (slotIndex + 0.5) * segmentDuration;

          // Seek to the center time of this segment
          video.currentTime = thumbCenterTime;

          // Wait for seek to complete
          await new Promise((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            };
            video.addEventListener('seeked', onSeeked);
          });

          if (cancelled) break;

          // Clear canvas before drawing
          ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

          // Draw video frame to canvas at target size
          // After ctx.setTransform, coordinates are in CSS pixels
          // Draw the video frame to fill the canvas (THUMB_WIDTH x THUMB_HEIGHT)
          ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

          // Extract as data URL with good quality
          // Quality 0.8 provides a good balance between file size and image quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

          // Debug logs for first few thumbnails (can be re-enabled for debugging)
          if (process.env.NODE_ENV === 'development' && slotIndex < 3) {
            console.log('[thumb-gen]', {
              slotIndex,
              thumbCenterTime,
              segmentStart: slotIndex * segmentDuration,
              segmentEnd: (slotIndex + 1) * segmentDuration,
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              targetWidth: THUMB_WIDTH,
              targetHeight: THUMB_HEIGHT
            });
          }

          // Store thumbnail with slotIndex and centerTime
          // slotIndex is used for rendering order, centerTime for reference
          generatedThumbnails.push({ 
            slotIndex, 
            centerTime: thumbCenterTime, 
            dataUrl 
          });
        }

        if (!cancelled) {
          setThumbnails(generatedThumbnails);
          setLoading(false);
        }

        // Cleanup
        video.pause();
        video.src = '';
      } catch (err) {
        console.error('Error generating thumbnails:', err);
        if (!cancelled) {
          setError(err.message || 'Failed to generate thumbnails');
          setLoading(false);
        }
      }
    };

    generateThumbnails();

    return () => {
      cancelled = true;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
    };
  }, [videoSrc, duration, trackWidth]);

  return { thumbnails, loading, error };
}

