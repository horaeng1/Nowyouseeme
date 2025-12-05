import { useEffect, useState, useRef } from 'react';

/**
 * Hook to generate audio waveform data from a video source using Web Audio API
 * 
 * Implementation:
 * 1. Fetches the video file as an ArrayBuffer
 * 2. Uses AudioContext.decodeAudioData() to decode the audio track
 * 3. Extracts channel data from the decoded AudioBuffer
 * 4. Downsamples by dividing the audio into buckets and calculating min/max per bucket
 * 5. Returns an array of peak values (min/max pairs) normalized to -1 to 1
 * 
 * Time alignment:
 * - The peaks array spans the entire video duration
 * - Each peak index i corresponds to time: time = (i / peaks.length) * duration
 * - This ensures perfect alignment with timeline click-to-seek logic
 * 
 * @param {string} videoSrc - URL of the video source
 * @param {number} duration - Duration of the video in seconds
 * @param {number} samples - Number of waveform samples to generate (default: 2000)
 * @returns {Object} { waveformData, loading, error }
 *   - waveformData: Array of { min, max } values representing audio peaks (normalized -1 to 1)
 *   - loading: Boolean indicating if waveform is being generated
 *   - error: Error message if generation failed
 */
export function useWaveform(videoSrc, duration, samples = 2000) {
  const [waveformData, setWaveformData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (!videoSrc || !duration || duration <= 0) {
      setWaveformData([]);
      return;
    }

    let cancelled = false;

    const generateWaveform = async () => {
      setLoading(true);
      setError(null);

      console.log('[useWaveform] Starting waveform generation for:', videoSrc);
      console.log('[useWaveform] Duration:', duration, 'seconds, Samples:', samples);

      try {
        // Step 1: Fetch the video file as ArrayBuffer
        console.log('[useWaveform] Fetching video file...');
        const response = await fetch(videoSrc);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
        }
        
        if (cancelled) return;

        const arrayBuffer = await response.arrayBuffer();
        console.log('[useWaveform] Fetched arrayBuffer, size:', arrayBuffer.byteLength, 'bytes');

        if (cancelled) return;

        // Step 2: Create AudioContext and decode audio data
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const audioContext = audioContextRef.current;

        console.log('[useWaveform] Starting decodeAudioData...');
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        console.log('[useWaveform] decodeAudioData completed successfully');
        console.log('[useWaveform] Decoded audio buffer:');
        console.log('  - Duration:', audioBuffer.duration, 'seconds');
        console.log('  - Sample rate:', audioBuffer.sampleRate, 'Hz');
        console.log('  - Number of channels:', audioBuffer.numberOfChannels);
        console.log('  - Length:', audioBuffer.length, 'samples');

        if (cancelled) return;

        // Step 3: Extract channel data (use first channel, or mix all channels)
        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        const sampleRate = audioBuffer.sampleRate;

        console.log('[useWaveform] Extracted channel data, length:', totalSamples);

        // Step 4: Downsample into buckets
        // Each bucket represents a time segment: bucketSize = totalSamples / samples
        // For each bucket, calculate min and max values
        const bucketSize = Math.floor(totalSamples / samples);
        console.log('[useWaveform] Downsampling: bucketSize =', bucketSize, 'samples per peak');

        const peaks = [];

        for (let i = 0; i < samples; i++) {
          if (cancelled) return;

          const start = i * bucketSize;
          const end = Math.min(start + bucketSize, totalSamples);

          let min = 0;
          let max = 0;

          // Find min and max in this bucket
          for (let j = start; j < end; j++) {
            const value = channelData[j];
            if (value < min) min = value;
            if (value > max) max = value;
          }

          peaks.push({ min, max });
        }

        console.log('[useWaveform] Computed', peaks.length, 'peaks');
        console.log('[useWaveform] Peak value range: min =', Math.min(...peaks.map(p => p.min)), ', max =', Math.max(...peaks.map(p => p.max)));

        if (!cancelled) {
          setWaveformData(peaks);
          setLoading(false);
          console.log('[useWaveform] Waveform generation completed successfully');
        }
      } catch (err) {
        console.error('[useWaveform] Error generating waveform:', err);
        console.error('[useWaveform] Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });

        if (!cancelled) {
          // Check if it's a CORS or decoding error
          if (err.name === 'EncodingError' || err.message.includes('decode')) {
            console.warn('[useWaveform] Audio decoding failed (possibly CORS or unsupported format). Rendering placeholder waveform.');
            setError('Audio decoding failed. Showing placeholder waveform.');
            // Generate a placeholder waveform (sine wave pattern)
            const placeholderPeaks = Array(samples).fill(null).map((_, i) => {
              const t = (i / samples) * Math.PI * 4;
              const amplitude = 0.3 + Math.sin(t) * 0.2;
              return { min: -amplitude, max: amplitude };
            });
            setWaveformData(placeholderPeaks);
          } else {
            setError(err.message || 'Failed to generate waveform');
            // Return empty waveform on error
            setWaveformData(Array(samples).fill({ min: 0, max: 0 }));
          }
          setLoading(false);
        }
      }
    };

    generateWaveform();

    return () => {
      cancelled = true;
      // Note: We don't close AudioContext here as it might be reused
      // AudioContext will be garbage collected when component unmounts
    };
  }, [videoSrc, duration, samples]);

  return { waveformData, loading, error };
}

