import { useEffect, useRef, useState } from 'react';
import VideoTimeline from './VideoTimeline';
import './VideoEditorLayout.css';

/**
 * YouTube Studio-style video editor layout component
 * 
 * This component recreates the "Editor / Trim & cut" screen layout with:
 * - Left sidebar: file information and navigation menu
 * - Main workspace: video preview + AD script panel
 * - Bottom timeline: audio and video tracks with time ruler
 * 
 * Props:
 * - video: { name, src, sizeBytes, duration, width, height, fps, thumbnailUrl }
 *   - name: string (file name)
 *   - src: string (blob URL for the video)
 *   - sizeBytes: number (file size in bytes, read from original File object and formatted in the UI)
 *   - duration: number (video duration in seconds)
 *   - width: number (video width in pixels)
 *   - height: number (video height in pixels)
 *   - fps: number (frame rate, default 30)
 *   - thumbnailUrl: string | null (data URL of thumbnail, generated once from the first frame if not provided externally)
 * - adScript: Array of { id, startTime, endTime, text }
 */
// Menu items (unchanged)
const menuItems = [
  { id: 'details', label: 'Details', icon: '📄' },
  { id: 'customization', label: 'Customization', icon: '🎨' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'editor', label: 'Editor', icon: '✂️' },
  { id: 'comments', label: 'Comments', icon: '💬' },
  { id: 'subtitles', label: 'Subtitles', icon: '📝' },
  { id: 'copyright', label: 'Copyright', icon: '©️' },
  { id: 'clips', label: 'Clips', icon: '🎬' }
];

interface VideoEditorLayoutProps {
  video: {
    name: string;
    src: string;
    sizeBytes: number;
    duration: number;
    width: number;
    height: number;
    fps: number;
    thumbnailUrl?: string | null;
    id?: string; // Video ID for AD generation
    serverPath?: string; // Server-side path to video file
  };
  adScript: Array<{
    id: number;
    startTime: string;
    endTime: string;
    text: string;
  }>;
  // TTS 적용된 영상/오디오 URL (upload 페이지에서 전달)
  initialAdVideoUrl?: string | null;
  initialAdAudioUrl?: string | null;
}

type AdSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

export default function VideoEditorLayout({ 
  video, 
  adScript: initialAdScript,
  initialAdVideoUrl = null,
  initialAdAudioUrl = null
}: VideoEditorLayoutProps) {
  // Debug logging
  console.log('[VideoEditorLayout] video', video);
  console.log('[VideoEditorLayout] initialAdScript', initialAdScript);
  console.log('[VideoEditorLayout] initialAdVideoUrl', initialAdVideoUrl);
  console.log('[VideoEditorLayout] initialAdAudioUrl', initialAdAudioUrl);

  const [selectedMenu, setSelectedMenu] = useState('editor');
  const [language, setLanguage] = useState<'ko' | 'en'>('ko');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(video.duration);
  const [volume, setVolume] = useState(1.0); // Volume state: 0.0 to 1.0
  const [isMuted, setIsMuted] = useState(false); // Mute state
  const [lastVolumeBeforeMute, setLastVolumeBeforeMute] = useState(1.0); // Remember volume before mute
  const [playbackRate, setPlaybackRate] = useState(1.0); // Playback speed: 0.5x, 1.0x, 1.25x, 1.5x, 2.0x
  const [showSpeedMenu, setShowSpeedMenu] = useState(false); // Show/hide playback speed dropdown
  const [isEditingTime, setIsEditingTime] = useState(false); // Timecode input edit mode
  const [timeInput, setTimeInput] = useState(''); // Raw input string for timecode
  const videoRef = useRef<HTMLVideoElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  // AD Script state
  // Parse time string (HH:MM:SS.FF) to seconds
  // Using function declaration for hoisting so it can be used in useState initializer
  function parseTimeToSeconds(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string') {
      return 0;
    }
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const secondsParts = parts[2].split('.');
      const seconds = parseInt(secondsParts[0], 10) || 0;
      const frames = parseInt(secondsParts[1] || '0', 10) || 0;
      return hours * 3600 + minutes * 60 + seconds + frames / 30; // Assuming 30 FPS
    }
    return 0;
  }

  const [adSegments, setAdSegments] = useState<AdSegment[]>(() => {
    // Convert initial adScript format to AdSegment format
    // Defensive check: ensure initialAdScript is an array
    if (!Array.isArray(initialAdScript)) {
      console.warn('[VideoEditorLayout] initialAdScript is not an array:', initialAdScript);
      return [];
    }

    if (initialAdScript.length === 0) {
      console.log('[VideoEditorLayout] initialAdScript is empty array');
      return [];
    }

    return initialAdScript.map((script, index) => {
      // Handle both string and number formats for start/end times
      const startTime = typeof script.startTime === 'string'
        ? script.startTime
        : typeof script.startTime === 'number'
          ? String(script.startTime)
          : '00:00:00.00';
      const endTime = typeof script.endTime === 'string'
        ? script.endTime
        : typeof script.endTime === 'number'
          ? String(script.endTime)
          : '00:00:00.00';

      const startSeconds = parseTimeToSeconds(startTime);
      const endSeconds = parseTimeToSeconds(endTime);

      return {
        id: script.id || index + 1,
        start: startSeconds,
        end: endSeconds,
        text: script.text || ''
      };
    });
  });

  // 원본 세그먼트 저장 (편집 추적용) - 처음 로드 시 저장
  const [originalSegments, setOriginalSegments] = useState<AdSegment[]>(() => {
    if (!Array.isArray(initialAdScript)) return [];
    return initialAdScript.map((script, index) => {
      const startTime = typeof script.startTime === 'string'
        ? script.startTime
        : typeof script.startTime === 'number'
          ? String(script.startTime)
          : '00:00:00.00';
      const endTime = typeof script.endTime === 'string'
        ? script.endTime
        : typeof script.endTime === 'number'
          ? String(script.endTime)
          : '00:00:00.00';
      return {
        id: script.id || index + 1,
        start: parseTimeToSeconds(startTime),
        end: parseTimeToSeconds(endTime),
        text: script.text || ''
      };
    });
  });

  const [adLoading, setAdLoading] = useState(false);
  const [adError, setAdError] = useState<string | null>(null);

  // TTS state
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  // TTS 적용된 영상 URL (upload 페이지에서 전달받은 경우 초기값으로 설정)
  const [adVideoUrl, setAdVideoUrl] = useState<string | null>(initialAdVideoUrl);
  const [adAudioUrl, setAdAudioUrl] = useState<string | null>(initialAdAudioUrl); // For AD waveform track
  // TTS가 적용된 상태로 진입했으면 'ad' 모드로 시작
  const [audioMode, setAudioMode] = useState<'original' | 'ad'>(initialAdVideoUrl ? 'ad' : 'original');

  // Find active script segment based on currentTime
  const getActiveScriptIndex = (): number => {
    for (let i = 0; i < adSegments.length; i++) {
      const segment = adSegments[i];
      if (currentTime >= segment.start && currentTime < segment.end) {
        return i;
      }
    }
    return -1;
  };

  const activeScriptIndex = getActiveScriptIndex();

  // Convert seconds to time string format (HH:MM:SS.FF)
  const formatTimeToScriptFormat = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30); // Assuming 30 FPS
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
  };

  // Handle AD generation button click
  // NOTE: Do not auto-call /api/generate-ad on page load.
  // It should only be triggered by the "AD 생성" button click.
  const handleGenerateAdClick = async () => {
    if (!video.id || !video.serverPath) {
      setAdError('비디오 ID 또는 서버 경로가 없습니다. 업로드된 비디오만 AD를 생성할 수 있습니다.');
      return;
    }

    try {
      setAdLoading(true);
      setAdError(null);

      const res = await fetch('/api/generate-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: video.id,
          server_path: video.serverPath, // Use server_path instead of video_path
          lang: language,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMessage = `HTTP ${res.status}: ${text}`;
        let errorCode = null;

        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorData.error || errorMessage;
          errorCode = errorData.code || null;
        } catch {
          // If parsing fails, use the text as-is
        }

        // Check for specific HTTP status codes
        if (res.status === 0 || res.status === 502) {
          errorMessage = '백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.';
        } else if (res.status === 400 || errorCode === 'JSON_PARSE_ERROR') {
          errorMessage = 'Gemini API 응답을 파싱할 수 없습니다. 다시 시도해주세요.';
        } else if (res.status === 503 || errorCode === 'SERVICE_UNAVAILABLE') {
          errorMessage = 'Gemini API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.';
        } else if (res.status === 429 || errorCode === 'RATE_LIMIT') {
          errorMessage = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
        } else if (res.status === 401 || errorCode === 'UNAUTHORIZED') {
          errorMessage = 'API 인증에 실패했습니다. 서버 설정을 확인해주세요.';
        }

        const error = new Error(errorMessage);
        (error as any).status = res.status;
        (error as any).code = errorCode;
        throw error;
      }

      const data = await res.json();

      if (data.status === 'error') {
        throw new Error(data.message || 'AD 생성 실패');
      }

      setAdSegments(data.segments || []);
    } catch (err: any) {
      console.error('AD 생성 오류:', err);

      let errorMessage = err.message || 'AD 생성 중 오류가 발생했습니다.';

      // Handle specific error types based on status code or error message
      if (err.status === 400 || err.code === 'JSON_PARSE_ERROR' ||
        (err.message && (err.message.includes('Failed to parse') || err.message.includes('JSON')))) {
        errorMessage = 'Gemini API 응답을 파싱할 수 없습니다. 다시 시도해주세요.';
      } else if (err.status === 503 || err.code === 'SERVICE_UNAVAILABLE' ||
        (err.message && (err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('overloaded')))) {
        errorMessage = 'Gemini API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.';
      } else if (err.status === 429 || err.code === 'RATE_LIMIT' ||
        (err.message && (err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('quota')))) {
        errorMessage = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
      } else if (err.status === 401 || err.code === 'UNAUTHORIZED' ||
        (err.message && (err.message.includes('401') || err.message.includes('unauthorized')))) {
        errorMessage = 'API 인증에 실패했습니다. 서버 설정을 확인해주세요.';
      }

      setAdError(errorMessage);
    } finally {
      setAdLoading(false);
    }
  };

  // 편집된 세그먼트 ID 감지 함수
  const getEditedSegmentIds = (): number[] => {
    const editedIds: number[] = [];
    
    adSegments.forEach(currentSeg => {
      const originalSeg = originalSegments.find(o => o.id === currentSeg.id);
      if (originalSeg) {
        // 시간이나 텍스트가 변경되었으면 편집됨으로 간주
        const startChanged = Math.abs(currentSeg.start - originalSeg.start) > 0.1;
        const endChanged = Math.abs(currentSeg.end - originalSeg.end) > 0.1;
        const textChanged = currentSeg.text !== originalSeg.text;
        
        if (startChanged || endChanged || textChanged) {
          editedIds.push(currentSeg.id);
        }
      }
    });
    
    return editedIds;
  };

  // 평가 정보 저장 함수 (TTS 적용 시 호출)
  const saveEditRatings = async () => {
    if (!video.id) return;

    const editedIds = getEditedSegmentIds();
    console.log('[Ratings] Edited segment IDs:', editedIds);

    if (editedIds.length === 0) {
      console.log('[Ratings] No segments edited, skipping rating save');
      return;
    }

    try {
      const payload = {
        originalSegments: originalSegments.map(seg => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: seg.text
        })),
        editedSegments: adSegments.map(seg => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          text: seg.text
        })),
        editedSegmentIds: editedIds,
        videoInfo: {
          fileName: video.name,
          duration: video.duration,
          width: video.width,
          height: video.height
        }
      };

      console.log('[Ratings] Saving edit ratings:', payload);

      const res = await fetch(`/api/ratings/${video.id}/apply-edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.error('[Ratings] Failed to save edit ratings:', await res.text());
        return;
      }

      const data = await res.json();
      console.log('[Ratings] Edit ratings saved:', data);
    } catch (err) {
      console.error('[Ratings] Error saving edit ratings:', err);
    }
  };

  // TTS generation handler - sends edited adSegments to server
  const handleGenerateTts = async () => {
    if (!video || !video.id) {
      setTtsError('비디오 ID가 없습니다.');
      return;
    }

    if (adSegments.length === 0) {
      setTtsError('AD 세그먼트가 없습니다. 먼저 AD를 생성해주세요.');
      return;
    }

    try {
      setTtsLoading(true);
      setTtsError(null);

      // Convert adSegments to the format expected by the server
      const segmentsForServer = adSegments.map(seg => ({
        id: seg.id,
        start: seg.start,
        end: seg.end,
        text: seg.text,
      }));

      console.log('[TTS] Sending edited segments to server:', segmentsForServer);

      const res = await fetch('/api/generate-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          lang: language,
          adSegments: segmentsForServer, // Send edited segments
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMessage = `HTTP ${res.status}: ${text}`;
        let errorCode = null;
        let errorDetail = null;

        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorData.error || errorMessage;
          errorCode = errorData.code || null;
          errorDetail = errorData.detail || null;

          // Log structured error for debugging
          console.error('[TTS] TTS API error response:', {
            status: res.status,
            error: errorData.error,
            code: errorData.code,
            message: errorData.message,
            detail: errorData.detail?.substring(0, 500) // Limit detail length for console
          });
        } catch {
          // If parsing fails, use the text as-is
          console.error('[TTS] Failed to parse error response:', text.substring(0, 500));
        }

        // Create error with structured information
        const error = new Error(errorMessage);
        (error as any).code = errorCode;
        (error as any).detail = errorDetail;
        throw error;
      }

      const data = await res.json();

      if (data.status === 'error') {
        console.error('[TTS] TTS generation failed:', data);
        const error = new Error(data.message || 'TTS 생성 실패');
        (error as any).code = data.code;
        (error as any).detail = data.detail;
        throw error;
      }

      console.log('[TTS] TTS generation result:', data);
      
      // TTS 성공 시 편집 평가 정보 저장
      await saveEditRatings();
      
      // Add cache buster to force reload on subsequent TTS generations
      const cacheBuster = `?t=${Date.now()}`;
      const newAdVideoUrl = data.adVideoUrl ? `${data.adVideoUrl}${cacheBuster}` : null;
      const newAdAudioUrl = data.adAudioUrl ? `${data.adAudioUrl}${cacheBuster}` : null;
      
      console.log('[TTS] Setting AD URLs with cache buster:', { newAdVideoUrl, newAdAudioUrl });
      
      setAdVideoUrl(newAdVideoUrl);
      setAdAudioUrl(newAdAudioUrl); // For AD waveform track
      setAudioMode('ad'); // Switch to AD audio automatically
    } catch (err: any) {
      console.error('[TTS] TTS 생성 오류:', err);
      console.error('[TTS] Error code:', (err as any).code);
      console.error('[TTS] Error detail:', (err as any).detail);

      // Provide user-friendly error messages based on error code
      let userMessage = err.message || 'TTS 생성 중 오류가 발생했습니다.';

      if ((err as any).code) {
        const code = (err as any).code;
        if (code === 'PYTHON_NOT_FOUND' || code === 'PYTHON_EXECUTABLE_NOT_FOUND') {
          userMessage = 'Python 실행 파일을 찾을 수 없습니다. PYTHON_TTS_EXECUTABLE 환경 변수를 설정해주세요.';
        } else if (code === 'TTS_FFMPEG_ERROR' || code === 'TTS_MODULE_NOT_FOUND') {
          userMessage = 'TTS 생성에 필요한 도구가 설치되지 않았습니다. 서버 로그를 확인해주세요.';
        } else if (code === 'TTS_AUDIOOP_ERROR') {
          userMessage = 'Python 3.13을 사용하는 경우 audioop-lts를 설치해주세요: pip install audioop-lts';
        } else if (code === 'VIDEO_FILE_MISSING' || code === 'AD_JSON_MISSING') {
          userMessage = '비디오 또는 AD 파일을 찾을 수 없습니다. 먼저 AD를 생성해주세요.';
        }
      }

      setTtsError(userMessage);
    } finally {
      setTtsLoading(false);
    }
  };

  // Calculate video source based on audio mode
  // Use originalUrl (HTTP URL) if available, otherwise fall back to src (blob URL)
  const originalVideoUrl = (video as any).originalUrl || video.src;
  const videoSrc = (audioMode === 'ad' && adVideoUrl)
    ? adVideoUrl
    : originalVideoUrl; // Use HTTP URL from server if available

  // Debug logging
  console.log('[VideoEditor] video.originalUrl:', (video as any).originalUrl);
  console.log('[VideoEditor] video.src:', video.src);
  console.log('[VideoEditor] adVideoUrl:', adVideoUrl);
  console.log('[VideoEditor] audioMode:', audioMode);
  console.log('[VideoEditor] selected videoSrc:', videoSrc);

  // Update video src when audio mode or adVideoUrl changes
  useEffect(() => {
    if (videoRef.current && videoSrc) {
      // For relative URLs starting with /, Vite proxy will handle it
      // Don't convert to absolute URL - let the browser handle it
      // This allows Vite proxy to route /static/* to backend
      let newSrc = videoSrc;

      // Only convert to absolute if it's not already absolute and not a blob URL
      if (!videoSrc.startsWith('http') && !videoSrc.startsWith('blob:') && !videoSrc.startsWith('/')) {
        // If it's a relative path without leading slash, add it
        newSrc = `/${videoSrc}`;
      }

      const currentSrc = videoRef.current.src;
      // Compare without origin to avoid unnecessary reloads
      const currentPath = currentSrc.replace(window.location.origin, '');
      if (currentPath !== newSrc && currentSrc !== newSrc) {
        console.log('[VideoEditor] Updating video src:', { from: currentSrc, to: newSrc });
        
        // Save current time before switching
        const savedTime = videoRef.current.currentTime;
        const wasPlaying = !videoRef.current.paused;
        
        videoRef.current.src = newSrc;
        videoRef.current.load(); // Reload video with new source
        
        // Restore position after load
        videoRef.current.onloadeddata = () => {
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(savedTime, videoRef.current.duration || savedTime);
            console.log('[VideoEditor] Restored time position:', savedTime);
            // Resume playback if was playing before
            if (wasPlaying) {
              videoRef.current.play().catch(err => {
                console.warn('[VideoEditor] Auto-resume play failed:', err);
              });
            }
          }
        };
      }
    }
  }, [videoSrc, audioMode, adVideoUrl]);

  // Video event handlers
  // 
  // FIX FOR: "Timeline timecode display feels too slow/laggy"
  // 
  // Problem: Previous implementation used 'timeupdate' event which only fires
  // about 4 times per second, causing visible lag in the timecode display.
  // 
  // Solution: Use requestAnimationFrame while playing to update currentTime
  // smoothly at ~60fps, matching the playhead/video position much more closely.
  // When paused, we still listen to timeupdate for manual seeks.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleLoadedMetadata = () => {
      setVideoDuration(videoElement.duration);
      // Sync initial volume and playback rate
      setVolume(videoElement.volume);
      setPlaybackRate(videoElement.playbackRate);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    // Fallback: listen to timeupdate when paused for manual seeks
    const handleTimeUpdate = () => {
      if (!isPlaying) {
        setCurrentTime(videoElement.currentTime);
      }
    };

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('ended', handleEnded);

    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('ended', handleEnded);
    };
  }, [video.src, isPlaying]);

  // Smooth timecode update using requestAnimationFrame while playing
  // This keeps currentTime fresh at ~60fps, eliminating the 1-second "step" feeling
  useEffect(() => {
    let frameId: number | undefined;

    const update = () => {
      const videoElement = videoRef.current;
      if (videoElement) {
        setCurrentTime(videoElement.currentTime);
      }
      if (isPlaying) {
        frameId = requestAnimationFrame(update);
      }
    };

    if (isPlaying) {
      frameId = requestAnimationFrame(update);
    }

    return () => {
      if (frameId !== undefined) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [isPlaying]);

  // Sync volume and playback rate to video element
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    videoElement.volume = volume;
    videoElement.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    videoElement.playbackRate = playbackRate;
  }, [playbackRate]);

  // Close speed menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(event.target as Node)) {
        setShowSpeedMenu(false);
      }
    };

    if (showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSpeedMenu]);

  // Handlers
  const handleMenuClick = (menuId: string) => {
    setSelectedMenu(menuId);
    console.log('Menu clicked:', menuId);
  };

  const handlePlayPause = () => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      console.warn('[VideoEditor] Video element not found, cannot play/pause');
      return;
    }

    // Check if video has a valid source
    const currentSrc = videoElement.currentSrc || videoElement.src;
    if (!currentSrc) {
      console.warn('[VideoEditor] No video source set, cannot play.');
      console.warn('[VideoEditor] currentSrc:', videoElement.currentSrc);
      console.warn('[VideoEditor] src:', videoElement.src);
      console.warn('[VideoEditor] videoSrc (computed):', videoSrc);
      console.warn('[VideoEditor] video object:', {
        originalUrl: (video as any).originalUrl,
        src: video.src,
        id: video.id
      });
      return;
    }

    if (isPlaying) {
      videoElement.pause();
    } else {
      const playPromise = videoElement.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.error('[VideoEditor] play() failed:', err);
          console.error('[VideoEditor] Video element state:', {
            src: videoElement.src,
            currentSrc: videoElement.currentSrc,
            readyState: videoElement.readyState,
            networkState: videoElement.networkState
          });
        });
      }
    }
  };

  // 5-second backward seek handler
  // Seeks the video 5 seconds backward, clamped to 0
  const handleSeekBackward = () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    const newTime = Math.max(0, videoElement.currentTime - 5);
    videoElement.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // 5-second forward seek handler
  // Seeks the video 5 seconds forward, clamped to duration
  const handleSeekForward = () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    const newTime = Math.min(videoDuration, videoElement.currentTime + 5);
    videoElement.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (timeInSeconds: number) => {
    setCurrentTime(timeInSeconds);
    if (videoRef.current) {
      videoRef.current.currentTime = timeInSeconds;
    }
  };

  const handleScrubBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const scrubBar = e.currentTarget;
    const rect = scrubBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * videoDuration;
    handleSeek(newTime);
  };

  // Volume and mute handling
  // Toggles mute on/off and remembers the previous volume value
  const handleVolumeToggle = () => {
    if (isMuted) {
      // Unmute and restore last non-zero volume
      setIsMuted(false);
      setVolume(lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 0.5);
    } else {
      // Mute and remember current volume
      setLastVolumeBeforeMute(volume > 0 ? volume : 0.5);
      setIsMuted(true);
    }
  };

  // Volume slider handler
  // Updates video.volume in real time as the slider moves
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
    if (newVolume > 0) {
      setLastVolumeBeforeMute(newVolume);
    }
  };

  // Playback speed options handler
  // Updates video.playbackRate immediately when an option is clicked
  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const playbackSpeedOptions = [0.5, 1.0, 1.25, 1.5, 2.0];

  // Parse timecode input string to seconds
  // 
  // Timecode input format parsing and seeking
  // Supports relatively forgiving input formats:
  // - MM:SS (e.g., "2:30" = 2 minutes 30 seconds)
  // - HH:MM:SS (e.g., "1:02:30" = 1 hour 2 minutes 30 seconds)
  // - HH:MM:SS:FF (e.g., "1:02:30:15" = 1 hour 2 minutes 30 seconds 15 frames)
  // 
  // Returns null if parsing fails (invalid format or non-numeric values)
  // The parsed seconds value is clamped to [0, duration] before seeking
  function parseTimecode(input: string, fps: number = 30): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(':').map(p => p.trim());
    if (parts.some(p => p === '' || isNaN(Number(p)))) return null;

    let h = 0, m = 0, s = 0, f = 0;

    if (parts.length === 2) {
      // MM:SS
      m = Number(parts[0]);
      s = Number(parts[1]);
    } else if (parts.length === 3) {
      // HH:MM:SS
      h = Number(parts[0]);
      m = Number(parts[1]);
      s = Number(parts[2]);
    } else if (parts.length === 4) {
      // HH:MM:SS:FF
      h = Number(parts[0]);
      m = Number(parts[1]);
      s = Number(parts[2]);
      f = Number(parts[3]);
    } else {
      return null;
    }

    const seconds = h * 3600 + m * 60 + s + f / fps;
    return seconds;
  }

  // Timecode input handlers
  // 
  // How the timecode input toggles between display and edit modes:
  // - When not editing: shows current time as clickable text that continuously updates
  // - When editing: shows input field where user can type timecode
  // - While editing, timeInput state prevents auto-overwriting (user can type freely)
  // - After seeking (Enter/blur), both currentTime state and video element currentTime are synced
  const handleTimeDisplayClick = () => {
    setIsEditingTime(true);
    setTimeInput(formatTimecode(currentTime)); // Initialize with current time
  };

  const handleTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Update timeInput state while user types - prevents auto-overwriting during editing
    setTimeInput(e.target.value);
  };

  const handleTimeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Parse input format and seek to the specified time
      // Input format is parsed and clamped to [0, duration] before seeking
      const seconds = parseTimecode(timeInput, 30);
      if (seconds != null && !isNaN(seconds)) {
        const clamped = Math.min(Math.max(seconds, 0), videoDuration);
        if (videoRef.current) {
          videoRef.current.currentTime = clamped;
        }
        setCurrentTime(clamped);
        handleSeek(clamped);
      }
      setIsEditingTime(false);
    } else if (e.key === 'Escape') {
      // Cancel editing without seeking
      setIsEditingTime(false);
      setTimeInput('');
    }
  };

  const handleTimeInputBlur = () => {
    // On blur, parse and seek (same behavior as Enter)
    // If parsing fails or input is invalid, revert to current time display
    const seconds = parseTimecode(timeInput, 30);
    if (seconds != null && !isNaN(seconds)) {
      const clamped = Math.min(Math.max(seconds, 0), videoDuration);
      if (videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
      setCurrentTime(clamped);
      handleSeek(clamped);
    }
    setIsEditingTime(false);
    setTimeInput('');
  };

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditingTime && timeInputRef.current) {
      timeInputRef.current.focus();
      timeInputRef.current.select();
    }
  }, [isEditingTime]);

  // AD segment text editing handler
  const handleSegmentTextChange = (index: number, newText: string) => {
    setAdSegments(prevSegments => {
      const updated = [...prevSegments];
      updated[index] = { ...updated[index], text: newText };
      return updated;
    });
  };

  // AD segment time editing handler
  const handleSegmentTimeChange = (index: number, field: 'start' | 'end', value: string) => {
    const seconds = parseTimeInputToSeconds(value);
    if (seconds !== null) {
      setAdSegments(prevSegments => {
        const updated = [...prevSegments];
        updated[index] = { ...updated[index], [field]: seconds };
        return updated;
      });
    }
  };

  // Parse user input time string to seconds (supports M:SS, MM:SS, H:MM:SS formats)
  const parseTimeInputToSeconds = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Handle plain number (seconds)
    if (!trimmed.includes(':')) {
      const num = parseFloat(trimmed);
      return isNaN(num) ? null : num;
    }

    const parts = trimmed.split(':').map(p => p.trim());
    if (parts.some(p => p === '' || isNaN(Number(p)))) return null;

    if (parts.length === 2) {
      // M:SS or MM:SS format
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      return m * 60 + s;
    } else if (parts.length === 3) {
      // H:MM:SS format
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      return h * 3600 + m * 60 + s;
    }
    return null;
  };

  // Format seconds to M:SS or MM:SS for display in time inputs
  const formatTimeInput = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const fraction = seconds % 1;
    const fractionStr = fraction > 0 ? `.${Math.round(fraction * 10)}` : '';
    return `${mins}:${String(secs).padStart(2, '0')}${fractionStr}`;
  };

  const handleCopyAll = () => {
    const allText = adSegments.map(s => {
      const startTime = formatTimeToScriptFormat(s.start);
      const endTime = formatTimeToScriptFormat(s.end);
      return `${startTime} – ${endTime}\n${s.text}`;
    }).join('\n\n');
    navigator.clipboard.writeText(allText).then(() => {
      console.log('All scripts copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!video.id || !video.serverPath) {
      setExportError('비디오 ID 또는 서버 경로가 없습니다.');
      return;
    }

    if (!adVideoUrl) {
      setExportError('먼저 TTS 변환을 완료한 뒤 내보내기를 시도해주세요.');
      return;
    }

    try {
      setExportLoading(true);
      setExportError(null);

      const payload = {
        videoId: video.id,
        serverPath: video.serverPath,
        adSegments: adSegments.map((segment) => ({
          id: segment.id,
          start: segment.start,
          end: segment.end,
          text: segment.text,
        })),
        options: {
          language,
        },
      };

      const res = await fetch('/api/export-with-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMessage = `HTTP ${res.status}: ${text}`;
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Ignore JSON parse errors and fall back to raw text
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      if (data.status === 'error') {
        throw new Error(data.message || '내보내기 실패');
      }

      const downloadUrl = data.downloadUrl;
      if (!downloadUrl) {
        throw new Error('내보내기 URL을 찾을 수 없습니다.');
      }

      const suggestedName = data.fileName || `Ko-AD_Export_${video.name || 'video'}.mp4`;
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = suggestedName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportError(err.message || '내보내기 중 오류가 발생했습니다.');
    } finally {
      setExportLoading(false);
    }
  };

  // Format time for display (H:MM:SS:FF format)
  // FIX FOR: "Timeline timecode display feels too slow/laggy"
  // 
  // Frame calculation: compute frame as Math.floor((currentTime % 1) * fps)
  // This ensures smooth frame updates without aggressive rounding
  // The seconds value changes multiple times per second, eliminating the 1-second "step" feeling
  const formatTimecode = (seconds: number): string => {
    const fps = 30; // Frame rate constant
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * fps); // Frame calculation: (fractional part) * fps
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  };

  // Format time for simple display (H:MM:SS)
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Format file size from bytes
  // Stop hard-coding 0.0 GB. Format from sizeBytes:
  // - If >= 0.1 GB, show in GB with 1 decimal place
  // - Otherwise, show in MB with 1 decimal place
  function formatFileSize(bytes: number): string {
    if (!bytes || bytes <= 0) return '0.0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  return (
    <div className="videoEditorLayout">
      {/* AD Generation Loading Overlay */}
      {adLoading && (
        <div className="ad-loading-overlay">
          <div className="ad-loading-modal">
            <div className="ad-loading-spinner" />
            <div className="ad-loading-message">
              AD를 생성하는 중입니다...<br />
              <span className="ad-loading-submessage">영상 길이에 따라 시간이 다소 걸릴 수 있습니다.</span>
            </div>
          </div>
        </div>
      )}
      {/* TTS Generation Loading Overlay */}
      {ttsLoading && (
        <div className="ad-loading-overlay">
          <div className="ad-loading-modal">
            <div className="ad-loading-spinner ad-loading-spinner--tts" />
            <div className="ad-loading-message">
              TTS를 생성하는 중입니다...<br />
              <span className="ad-loading-submessage">AD 세그먼트 수에 따라 시간이 다소 걸릴 수 있습니다.</span>
            </div>
          </div>
        </div>
      )}
      {/* Left Sidebar: File Information Panel */}
      <aside className="videoEditorLayout__sidebar">
        {/* File Info Section */}
        <div className="videoEditorLayout__fileInfo">
          {/* Thumbnail - use real thumbnailUrl from video metadata */}
          <div className="videoEditorLayout__thumbnail">
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt={video.name}
                className="videoEditorLayout__thumbnailImage"
              />
            ) : (
              <div className="videoEditorLayout__thumbnailPlaceholder">
                {video.name}
              </div>
            )}
          </div>
          <h2 className="videoEditorLayout__title">{video.name}</h2>
          <div className="videoEditorLayout__metadata">
            {/* Duration - use real video duration */}
            <div className="videoEditorLayout__metadataItem">
              <span className="videoEditorLayout__metadataLabel">Duration:</span>
              <span className="videoEditorLayout__metadataValue">{formatDuration(videoDuration)}</span>
            </div>
            {/* Resolution - use real width x height */}
            <div className="videoEditorLayout__metadataItem">
              <span className="videoEditorLayout__metadataLabel">Resolution:</span>
              <span className="videoEditorLayout__metadataValue">{video.width}x{video.height}</span>
            </div>
            {/* File size - format from sizeBytes */}
            <div className="videoEditorLayout__metadataItem">
              <span className="videoEditorLayout__metadataLabel">File size:</span>
              <span className="videoEditorLayout__metadataValue">{formatFileSize(video.sizeBytes)}</span>
            </div>
            {/* Frame rate - use real fps */}
            <div className="videoEditorLayout__metadataItem">
              <span className="videoEditorLayout__metadataLabel">Frame rate:</span>
              <span className="videoEditorLayout__metadataValue">{video.fps} FPS</span>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="videoEditorLayout__menu">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`videoEditorLayout__menuItem ${selectedMenu === item.id ? 'videoEditorLayout__menuItem--active' : ''}`}
              onClick={() => handleMenuClick(item.id)}
            >
              <span className="videoEditorLayout__menuIcon">{item.icon}</span>
              <span className="videoEditorLayout__menuLabel">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Workspace: Video Preview + AD Script Panel */}
      <main className="videoEditorLayout__workspace">
        {/* Top Area: Two Columns */}
        <div className="videoEditorLayout__topArea">
          {/* Left: Video Preview */}
          <section className="videoEditorLayout__preview">
            <div className="videoEditorLayout__previewHeader">
              <h3 className="videoEditorLayout__previewTitle">Trim & cut</h3>
              <div className="videoEditorLayout__previewActions">
                <button className="videoEditorLayout__button">Back</button>
                <button className="videoEditorLayout__button videoEditorLayout__button--primary">Save</button>
                <button className="videoEditorLayout__button videoEditorLayout__button--icon">⋯</button>
              </div>
            </div>
            <div className="videoEditorLayout__player">
              <div className="videoEditorLayout__playerFrame">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000'
                  }}
                  playsInline
                />
              </div>
              {/* Very compact control bar - height controlled via CSS (28-32px)
               * Layout: [Play] [5s back] [5s forward] [time] [progress bar (flex)] [Volume] [Settings]
               * Left group: play, backward, forward, time display (fixed width)
               * Center: progress bar (flex-grow: 1)
               * Right group: volume icon + slider, settings icon (fixed width)
               */}
              <div className="videoEditorLayout__playerControls">
                {/* Left group: Play/Pause, 5s backward, 5s forward, time display */}
                <div className="videoEditorLayout__controlsLeft">
                  <button
                    className="videoEditorLayout__controlButton"
                    onClick={handlePlayPause}
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  {/* 5-second backward icon - Replay5 style: circular arrow with "5" inside */}
                  <button
                    className="videoEditorLayout__controlButton"
                    onClick={handleSeekBackward}
                    title="5 seconds backward"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ width: '20px', height: '20px' }}
                      className="videoEditorLayout__skipIcon"
                    >
                      {/* Circular arrow path (counter-clockwise) - Material Icons Replay5 style */}
                      <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                      {/* Number "5" in the center */}
                      <text
                        x="12"
                        y="15.5"
                        textAnchor="middle"
                        fontSize="8"
                        fill="currentColor"
                        fontWeight="600"
                        fontFamily="system-ui, -apple-system, sans-serif"
                      >
                        5
                      </text>
                    </svg>
                  </button>
                  {/* 5-second forward icon - Forward5 style: circular arrow with "5" inside */}
                  <button
                    className="videoEditorLayout__controlButton"
                    onClick={handleSeekForward}
                    title="5 seconds forward"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      style={{ width: '20px', height: '20px' }}
                      className="videoEditorLayout__skipIcon"
                    >
                      {/* Circular arrow path (clockwise) - Material Icons Forward5 style */}
                      <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                      {/* Number "5" in the center */}
                      <text
                        x="12"
                        y="15.5"
                        textAnchor="middle"
                        fontSize="8"
                        fill="currentColor"
                        fontWeight="600"
                        fontFamily="system-ui, -apple-system, sans-serif"
                      >
                        5
                      </text>
                    </svg>
                  </button>
                  <span className="videoEditorLayout__timeDisplay">
                    {formatTime(currentTime)} / {formatTime(videoDuration)}
                  </span>
                </div>

                {/* Center: Progress bar (flex-grow: 1) - takes all remaining space */}
                <div className="videoEditorLayout__controlsCenter">
                  <div
                    className="videoEditorLayout__scrubBar"
                    onClick={handleScrubBarClick}
                    title="Click to seek"
                  >
                    <div
                      className="videoEditorLayout__scrubBarFill"
                      style={{ width: `${videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Right group: Volume icon + slider, Settings (playback speed)
                 * Volume and settings icons are intentionally placed on the right side of the progress bar
                 */}
                <div className="videoEditorLayout__controlsRight">
                  {/* Volume control: icon + slider */}
                  <div className="videoEditorLayout__volumeControl">
                    <button
                      className="videoEditorLayout__controlButton"
                      onClick={handleVolumeToggle}
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? '🔇' : volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="videoEditorLayout__volumeSlider"
                      title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                    />
                  </div>

                  {/* Settings (playback speed) with dropdown */}
                  <div className="videoEditorLayout__speedControl" ref={speedMenuRef}>
                    <button
                      className="videoEditorLayout__controlButton"
                      onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                      title={`Playback speed: ${playbackRate}x`}
                    >
                      ⚙️
                    </button>
                    {showSpeedMenu && (
                      <div className="videoEditorLayout__speedMenu">
                        {playbackSpeedOptions.map((rate) => (
                          <button
                            key={rate}
                            className={`videoEditorLayout__speedOption ${playbackRate === rate ? 'videoEditorLayout__speedOption--active' : ''}`}
                            onClick={() => handleSpeedChange(rate)}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right: AD Script Panel */}
          <section className="videoEditorLayout__scriptPanel">
            <div className="videoEditorLayout__scriptHeader">
              <h3 className="videoEditorLayout__scriptTitle">AD Script</h3>
              <div className="videoEditorLayout__scriptActions">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as 'ko' | 'en')}
                  className="videoEditorLayout__languageSelect"
                  style={{
                    marginRight: '8px',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: '1px solid #444',
                    backgroundColor: '#333',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                  disabled={adLoading || ttsLoading}
                >
                  <option value="ko">Korean (한국어)</option>
                  <option value="en">English (영어)</option>
                </select>
                <button
                  className="videoEditorLayout__button videoEditorLayout__button--primary"
                  onClick={handleGenerateAdClick}
                  disabled={adLoading || !video.id || !video.serverPath}
                  title={!video.id || !video.serverPath ? '업로드된 비디오만 AD를 생성할 수 있습니다.' : 'AD 생성'}
                >
                  {adLoading ? '생성 중...' : 'AD 생성'}
                </button>
                <button
                  className="videoEditorLayout__button videoEditorLayout__button--primary"
                  onClick={handleGenerateTts}
                  disabled={ttsLoading || !video.id || adSegments.length === 0}
                  title={!video.id ? '비디오가 필요합니다.' : adSegments.length === 0 ? '먼저 AD를 생성해주세요.' : 'TTS 변환'}
                >
                  {ttsLoading ? 'TTS 생성 중...' : 'TTS 변환'}
                </button>
                <button
                  className="videoEditorLayout__button videoEditorLayout__button--ghost"
                  onClick={handleCopyAll}
                  disabled={adSegments.length === 0}
                >
                  Copy all
                </button>
                <button
                  className="videoEditorLayout__button videoEditorLayout__button--ghost"
                  onClick={handleExport}
                  disabled={adSegments.length === 0}
                >
                  Export
                </button>
              </div>
            </div>
            <div className="videoEditorLayout__scriptContent">
              {adError && (
                <div className="videoEditorLayout__scriptBody videoEditorLayout__scriptBody--error">
                  <div className="ad-error-title">AD 생성 중 오류가 발생했습니다.</div>
                  <div className="ad-error-message">{adError}</div>
                  {(adError.includes('과부하') || adError.includes('잠시 후') || adError.includes('한도') || adError.includes('파싱')) && (
                    <button
                      className="videoEditorLayout__button videoEditorLayout__button--primary"
                      onClick={handleGenerateAdClick}
                      disabled={adLoading}
                      style={{ marginTop: '12px', width: '100%' }}
                    >
                      {adLoading ? '재시도 중...' : '다시 시도'}
                    </button>
                  )}
                </div>
              )}
              {/* TTS Error Display */}
              {ttsError && (
                <div className="videoEditorLayout__scriptBody videoEditorLayout__scriptBody--error" style={{ marginBottom: '12px' }}>
                  <div className="ad-error-title">TTS 생성 중 오류가 발생했습니다.</div>
                  <div className="ad-error-message">{ttsError}</div>
                  <button
                    className="videoEditorLayout__button videoEditorLayout__button--primary"
                    onClick={handleGenerateTts}
                    disabled={ttsLoading}
                    style={{ marginTop: '12px', width: '100%' }}
                  >
                    {ttsLoading ? '재시도 중...' : '다시 시도'}
                  </button>
                </div>
              )}
              {/* Audio Mode Toggle */}
              {adVideoUrl && (
                <div className="videoEditorLayout__scriptBody" style={{ marginBottom: '12px', padding: '12px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
                  <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>오디오 모드:</div>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        value="original"
                        checked={audioMode === 'original'}
                        onChange={() => setAudioMode('original')}
                      />
                      <span style={{ fontSize: '13px', color: '#fff' }}>원본 오디오</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        value="ad"
                        checked={audioMode === 'ad'}
                        onChange={() => setAudioMode('ad')}
                      />
                      <span style={{ fontSize: '13px', color: '#fff' }}>AD 적용 오디오</span>
                    </label>
                  </div>
                </div>
              )}
              <div className="videoEditorLayout__exportPanel">
                <div className="videoEditorLayout__exportText">
                  <div className="videoEditorLayout__exportTitle">Export Video</div>
                  <p>AD 오디오가 포함된 최종 영상을 다운로드합니다.</p>
                </div>
                <button
                  className="videoEditorLayout__button videoEditorLayout__button--primary"
                  onClick={handleExport}
                  disabled={adSegments.length === 0 || !adVideoUrl || exportLoading}
                  title={
                    adSegments.length === 0
                      ? 'AD 세그먼트가 없습니다.'
                      : !adVideoUrl
                        ? '먼저 TTS 변환을 완료해주세요.'
                        : 'AD가 포함된 비디오 내보내기'
                  }
                >
                  {exportLoading ? '내보내는 중...' : 'Export Video'}
                </button>
              </div>
              {!adError && !adLoading && adSegments.length === 0 && (
                <div className="videoEditorLayout__scriptBody videoEditorLayout__scriptBody--empty">
                  AD가 아직 생성되지 않았습니다. "AD 생성" 버튼을 눌러주세요.
                </div>
              )}
              {!adError && !adLoading && adSegments.length > 0 && adSegments.map((script, index) => {
                // 편집 여부 확인
                const originalSeg = originalSegments.find(o => o.id === script.id);
                const isEdited = originalSeg && (
                  Math.abs(script.start - originalSeg.start) > 0.1 ||
                  Math.abs(script.end - originalSeg.end) > 0.1 ||
                  script.text !== originalSeg.text
                );

                return (
                  <div
                    key={script.id}
                    className={`videoEditorLayout__scriptSegment ${activeScriptIndex === index ? 'videoEditorLayout__scriptSegment--active' : ''} ${isEdited ? 'videoEditorLayout__scriptSegment--edited' : ''}`}
                  >
                    <div className="videoEditorLayout__scriptTimeRange">
                      <input
                        type="text"
                        value={formatTimeInput(script.start)}
                        onChange={(e) => handleSegmentTimeChange(index, 'start', e.target.value)}
                        className="videoEditorLayout__timeInput"
                        placeholder="0:00"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="videoEditorLayout__timeSeparator">–</span>
                      <input
                        type="text"
                        value={formatTimeInput(script.end)}
                        onChange={(e) => handleSegmentTimeChange(index, 'end', e.target.value)}
                        className="videoEditorLayout__timeInput"
                        placeholder="0:00"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="videoEditorLayout__seekButton"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSeek(script.start);
                        }}
                        title="이 구간으로 이동"
                      >
                        ▶
                      </button>
                      {isEdited && (
                        <span className="videoEditorLayout__ratingIndicator videoEditorLayout__ratingIndicator--edited" title="편집됨 - TTS 적용 시 자동 평가됩니다">
                          ✏️ 편집됨
                        </span>
                      )}
                    </div>
                    <textarea
                      value={script.text}
                      onChange={(e) => handleSegmentTextChange(index, e.target.value)}
                      className="videoEditorLayout__scriptTextarea"
                      placeholder="AD 스크립트를 입력하세요..."
                      rows={2}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {isEdited && originalSeg && (
                      <div className="videoEditorLayout__originalText" title="원본 텍스트">
                        <span className="videoEditorLayout__originalLabel">원본:</span>
                        <span className="videoEditorLayout__originalContent">{originalSeg.text}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Bottom: Timeline Area */}
        <section className="videoEditorLayout__timeline">
          {/* Single Control Bar - time display on left, zoom controls on right */}
          <div className="videoEditorLayout__timelineControls">
            <div className="videoEditorLayout__timelineControlsLeft">
              {/* Timecode input - toggles between display and edit modes
               * When not editing: shows current time as clickable text
               * When editing: shows input field for typing timecode (MM:SS, HH:MM:SS, or HH:MM:SS:FF)
               * Enter or blur seeks to the parsed time, clamped to [0, duration]
               */}
              {isEditingTime ? (
                <input
                  ref={timeInputRef}
                  type="text"
                  value={timeInput}
                  onChange={handleTimeInputChange}
                  onBlur={handleTimeInputBlur}
                  onKeyDown={handleTimeInputKeyDown}
                  className="videoEditorLayout__timecodeInput"
                  placeholder="0:00:00:00"
                />
              ) : (
                <span
                  className="videoEditorLayout__timecode videoEditorLayout__timecode--clickable"
                  onClick={handleTimeDisplayClick}
                  title="Click to edit timecode"
                >
                  {formatTimecode(currentTime)}
                </span>
              )}
            </div>
            <div className="videoEditorLayout__timelineControlsRight">
              <button className="videoEditorLayout__button videoEditorLayout__button--icon">−</button>
              <input
                type="range"
                className="videoEditorLayout__zoomSlider"
                min="0"
                max="100"
                defaultValue="30"
              />
              <button className="videoEditorLayout__button videoEditorLayout__button--icon">+</button>
            </div>
          </div>

          {/* Timeline Component - Reusing existing VideoTimeline */}
          <div className="videoEditorLayout__timelineArea">
            {videoDuration > 0 && (
              <VideoTimeline
                videoSrc={video.src}
                adAudioSrc={adAudioUrl || adVideoUrl} // Prefer wav file for AD waveform, fallback to video
                duration={videoDuration}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
