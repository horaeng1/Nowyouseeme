import { useLocation, useNavigate } from 'react-router-dom';
import VideoEditorLayout from '../components/VideoEditorLayout';

/**
 * Video Editor Page
 * 
 * This page is mounted at /video-editor.
 * 
 * It expects navigation state { video, adScript } from the upload page:
 * - video: { name, src, sizeBytes, duration, width, height, fps, thumbnailUrl }
 *   - name: string (file name)
 *   - src: string (blob URL for the video)
 *   - sizeBytes: number (file size in bytes)
 *   - duration: number (video duration in seconds)
 *   - width: number (video width in pixels)
 *   - height: number (video height in pixels)
 *   - fps: number (frame rate, default 30)
 *   - thumbnailUrl: string | null (data URL of thumbnail, generated from first frame if not provided externally)
 * - adScript: Array of { id, startTime, endTime, text }
 * 
 * If state is missing (direct URL access), shows a fallback message.
 * 
 * It reuses the existing VideoTimeline component for waveform + thumbnails.
 */
type EditorLocationState = {
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
    originalUrl?: string; // HTTP URL for video playback
  };
  adScript: Array<{
    id: number;
    startTime: string;
    endTime: string;
    text: string;
  }>;
  // TTS 적용된 영상/오디오 URL (upload 페이지에서 전달)
  adVideoUrl?: string | null;
  adAudioUrl?: string | null;
};

export default function VideoEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as EditorLocationState | undefined;
  const { video, adScript, adVideoUrl, adAudioUrl } = state || {};

  // Debug logging
  console.log('[VideoEditorPage] location.state:', state);
  console.log('[VideoEditorPage] video:', video);
  console.log('[VideoEditorPage] adScript:', adScript);
  console.log('[VideoEditorPage] adVideoUrl:', adVideoUrl);
  console.log('[VideoEditorPage] adAudioUrl:', adAudioUrl);

  // If no video data, show fallback
  if (!video || !adScript) {
    console.warn('[VideoEditorPage] Missing video or adScript, showing fallback');
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        background: '#0f0f0f',
        color: '#f1f1f1',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <h2>No video loaded</h2>
        <p style={{ color: '#aaaaaa' }}>Please upload a video from the upload page first.</p>
        <button 
          onClick={() => navigate('/upload')}
          style={{
            padding: '12px 24px',
            background: '#3ea6ff',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Go to Upload Page
        </button>
      </div>
    );
  }

  return (
    <VideoEditorLayout 
      video={video} 
      adScript={adScript} 
      initialAdVideoUrl={adVideoUrl}
      initialAdAudioUrl={adAudioUrl}
    />
  );
}

