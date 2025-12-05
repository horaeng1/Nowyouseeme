import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../components/VideoEditorLayout.css'; // For loading overlay styles
import { useAuth } from '../contexts/AuthContext';

// SessionStorage keys
const STORAGE_KEYS = {
  FILES: 'uploadPage_files',
  UPLOADING: 'uploadPage_uploading',
  METADATA: 'uploadPage_metadata',
  THUMBNAILS: 'uploadPage_thumbnails',
  AD_RESULTS: 'uploadPage_adResults',
  SCRIPT: 'uploadPage_script',
  SELECTED_INDEX: 'uploadPage_selectedIndex'
};

const defaultScript = [
  '장면 01: 푸른 숲 위로 카메라가 천천히 이동합니다.',
  '장면 02: 주인공이 웃으며 화면 중앙에 등장합니다.',
  '장면 03: 화면해설을 넣을 수 있는 무음 구간입니다.'
];

// Generate thumbnail from video file
// Seeks to a small offset (1 second or 10% of duration) to avoid black first frame
// Returns a data URL of the thumbnail image
async function generateThumbnail(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    video.muted = true;

    video.addEventListener('loadeddata', () => {
      // Seek to a small offset so the first frame isn't black
      video.currentTime = Math.min(1, video.duration / 10);
    });

    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(video.src);
        return reject(new Error('no ctx'));
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(video.src);
      resolve(url);
    });

    video.addEventListener('error', (e) => {
      URL.revokeObjectURL(video.src);
      reject(e);
    });
  });
}

// Extract video metadata (duration, width, height, fps) from file
async function extractVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    video.muted = true;

    video.addEventListener('loadedmetadata', () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        fps: 30 // Default FPS, can be extracted from video if available
      };
      URL.revokeObjectURL(video.src);
      resolve(metadata);
    });

    video.addEventListener('error', (e) => {
      URL.revokeObjectURL(video.src);
      reject(e);
    });
  });
}

// Helper to safely parse JSON from sessionStorage
const getStoredData = (key, defaultValue) => {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

export default function UploadPage() {
  // Auth 훅 - 인증 헤더 및 크레딧 새로고침
  const { getAuthHeaders, refreshCredits, isAuthenticated, credits, loading: authLoading } = useAuth();
  
  // Initialize state from sessionStorage
  const [files, setFiles] = useState(() => getStoredData(STORAGE_KEYS.FILES, []));
  const [selectedIndex, setSelectedIndex] = useState(() => getStoredData(STORAGE_KEYS.SELECTED_INDEX, 0));
  const [script, setScript] = useState(() => getStoredData(STORAGE_KEYS.SCRIPT, defaultScript.join('\n')));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [inputSourceTab, setInputSourceTab] = useState('file'); // 'file' | 'youtube'
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const [previewTab, setPreviewTab] = useState('original');
  const navigate = useNavigate();
  const [videoMetadata, setVideoMetadata] = useState(() => getStoredData(STORAGE_KEYS.METADATA, {}));
  const [thumbnails, setThumbnails] = useState(() => getStoredData(STORAGE_KEYS.THUMBNAILS, {}));
  const [uploading, setUploading] = useState(() => getStoredData(STORAGE_KEYS.UPLOADING, {}));
  const [uploadError, setUploadError] = useState(null); // Global upload error
  
  // AD/TTS 생성 관련 state
  const [adGenerating, setAdGenerating] = useState(false); // AD+TTS 생성 중 여부
  const [adGenerationStep, setAdGenerationStep] = useState(''); // 현재 진행 단계: 'ad', 'tts', 'done'
  const [adGenerationError, setAdGenerationError] = useState(null); // 에러 메시지
  const [adResults, setAdResults] = useState(() => getStoredData(STORAGE_KEYS.AD_RESULTS, {}));
  
  // 모델 및 언어 선택 state
  const [selectedModel, setSelectedModel] = useState('gpt'); // 'gpt' | 'gemini'
  const [selectedLang, setSelectedLang] = useState('ko'); // 'ko' | 'en' | 'ja' | 'zh'
  
  // TTS 음성 프로필 선택 state
  const [selectedVoiceProfile, setSelectedVoiceProfile] = useState('gtts'); // 'gtts' | 'kor_male' | 'kor_female' | 'eng_male' | 'eng_female'
  const [enableDucking, setEnableDucking] = useState(true); // 더킹 활성화 여부
  
  // 평가 정보 state - { [fileName]: { [segmentId]: 'like' | 'dislike' | 'neutral' } }
  const [segmentRatings, setSegmentRatings] = useState({});
  
  // Save state to sessionStorage when it changes
  // Note: file object cannot be serialized, so we save only serializable properties
  useEffect(() => {
    const serializableFiles = files.map(({ file, ...rest }) => rest);
    sessionStorage.setItem(STORAGE_KEYS.FILES, JSON.stringify(serializableFiles));
  }, [files]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.UPLOADING, JSON.stringify(uploading));
  }, [uploading]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(videoMetadata));
  }, [videoMetadata]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.THUMBNAILS, JSON.stringify(thumbnails));
  }, [thumbnails]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.AD_RESULTS, JSON.stringify(adResults));
  }, [adResults]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SCRIPT, JSON.stringify(script));
  }, [script]);
  
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.SELECTED_INDEX, JSON.stringify(selectedIndex));
  }, [selectedIndex]);

  // blob URL은 EditorPage에서 사용할 때까지 유지해야 하므로
  // 여기서는 revoke하지 않습니다.
  // 대신 EditorPage에서 사용 후 또는 앱 종료 시 정리합니다.
  // useEffect(
  //   () => () => {
  //     files.forEach((file) => URL.revokeObjectURL(file.preview));
  //   },
  //   [files]
  // );

  // Upload a single file to the server
  const handleUploadFile = async (file) => {
    const fileName = file.name;
    console.log('[UploadPage] Starting upload for file:', fileName);

    // Set uploading state
    setUploading((prev) => ({
      ...prev,
      [fileName]: { uploading: true, error: null, uploaded: false, videoId: null, serverPath: null }
    }));
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('video', file); // Backend expects 'video' field

      console.log('[UploadPage] Sending request to /api/upload');
      console.log('[UploadPage] File details:', {
        name: file.name,
        size: file.size,
        type: file.type,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
      });
      
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 600000); // 10 minutes timeout
      
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal
          // Do NOT set Content-Type header - browser will set it with boundary
        });
        
        clearTimeout(timeoutId);

        console.log('[UploadPage] Upload response status:', res.status);
        console.log('[UploadPage] Upload response statusText:', res.statusText);
        console.log('[UploadPage] Upload response headers:', Object.fromEntries(res.headers.entries()));

        if (!res.ok) {
          const text = await res.text();
          console.error('[UploadPage] Upload failed - status:', res.status);
          console.error('[UploadPage] Upload failed - statusText:', res.statusText);
          console.error('[UploadPage] Upload failed - response body:', text);
          
          let errorMessage = `업로드 실패: HTTP ${res.status}`;
          try {
            const errorData = JSON.parse(text);
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch {
            errorMessage = text || errorMessage;
          }

          // Check if it's a connection error
          if (res.status === 0 || res.status === 502 || res.status === 503) {
            errorMessage = '백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.';
          }

          throw new Error(errorMessage);
        }

        const text = await res.text();
        console.log('[UploadPage] Upload response body (raw):', text);
        
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.error('[UploadPage] Failed to parse JSON response:', parseError);
          throw new Error('서버 응답을 파싱할 수 없습니다.');
        }
        
        console.log('[UploadPage] Upload success:', data);

        const serverVideoUrl = data.originalVideoUrl || `/static/upload/${data.id || data.videoId}.mp4`;

        // Update uploading state with success
        setUploading((prev) => ({
          ...prev,
          [fileName]: {
            uploading: false,
            error: null,
            uploaded: true,
            videoId: data.id || data.videoId,
            serverPath: data.serverPath || data.sourceDiskPath,
            originalVideoUrl: serverVideoUrl
          }
        }));
        
        // Update files to use server URL instead of blob URL (for persistence)
        setFiles((prev) => prev.map((f) => 
          f.name === fileName 
            ? { ...f, preview: serverVideoUrl, serverUrl: serverVideoUrl }
            : f
        ));

        return {
          videoId: data.id || data.videoId,
          serverPath: data.serverPath || data.sourceDiskPath,
          originalVideoUrl: serverVideoUrl
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (err) {
      console.error('[UploadPage] Upload exception:', err);
      console.error('[UploadPage] Error name:', err.name);
      console.error('[UploadPage] Error message:', err.message);
      
      let errorMessage = err.message || '동영상 업로드 중 오류가 발생했습니다.';
      
      // Handle specific error types
      if (err.name === 'AbortError') {
        errorMessage = '업로드 시간이 초과되었습니다. 파일 크기가 너무 크거나 네트워크 연결이 불안정합니다.';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('ERR_CONNECTION_RESET')) {
        errorMessage = '백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하고, 파일 크기가 너무 크지 않은지 확인해주세요.';
      }
      
      // Update uploading state with error
      setUploading((prev) => ({
        ...prev,
        [fileName]: {
          uploading: false,
          error: errorMessage,
          uploaded: false,
          videoId: null,
          serverPath: null
        }
      }));
      
      setUploadError(errorMessage);
      throw err;
    }
  };

  // AD 생성 + TTS 변환 한 번에 처리
  const handleGenerateADAndTTS = async () => {
    const selectedFile = files[selectedIndex];
    if (!selectedFile) {
      alert('선택된 파일이 없습니다.');
      return;
    }

    const uploadInfo = uploading[selectedFile.name];
    if (!uploadInfo?.uploaded || !uploadInfo?.videoId) {
      alert('파일이 아직 업로드되지 않았습니다. 업로드가 완료될 때까지 기다려주세요.');
      return;
    }

    const videoId = uploadInfo.videoId;
    const serverPath = uploadInfo.serverPath;
    
    if (!serverPath) {
      alert('서버 경로 정보가 없습니다. 파일을 다시 업로드해주세요.');
      return;
    }
    
    setAdGenerating(true);
    setAdGenerationError(null);
    setAdGenerationStep('ad');

    try {
      // Step 1: AD 생성
      console.log('[UploadPage] Starting AD generation for videoId:', videoId, 'serverPath:', serverPath, 'model:', selectedModel, 'lang:', selectedLang);
      const adResponse = await fetch('/api/generate-ad', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders() // 인증 헤더 추가 (크레딧 차감용)
        },
        body: JSON.stringify({ video_id: videoId, server_path: serverPath, lang: selectedLang, model: selectedModel })
      });

      if (!adResponse.ok) {
        const errorText = await adResponse.text();
        throw new Error(`AD 생성 실패: ${errorText}`);
      }

      const adData = await adResponse.json();
      console.log('[UploadPage] AD generation result:', adData);
      
      // AD 세그먼트 저장 (더 이상 script에 시간 정보를 포함하지 않음)

      // Step 2: TTS 변환
      setAdGenerationStep('tts');
      console.log('[UploadPage] Starting TTS generation for videoId:', videoId, 'lang:', selectedLang, 'voiceProfile:', selectedVoiceProfile, 'enableDucking:', enableDucking);
      
      const ttsResponse = await fetch('/api/generate-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoId, 
          lang: selectedLang,
          adSegments: adData.segments, // AD 생성 결과를 그대로 전달
          voiceProfile: selectedVoiceProfile, // TTS 음성 프로필
          enableDucking: enableDucking // 더킹 활성화 여부
        })
      });

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text();
        throw new Error(`TTS 변환 실패: ${errorText}`);
      }

      const ttsData = await ttsResponse.json();
      console.log('[UploadPage] TTS generation result:', ttsData);

      // 결과 저장
      const cacheBuster = `?t=${Date.now()}`;
      setAdResults(prev => ({
        ...prev,
        [selectedFile.name]: {
          adVideoUrl: ttsData.adVideoUrl ? `${ttsData.adVideoUrl}${cacheBuster}` : null,
          adAudioUrl: ttsData.adAudioUrl ? `${ttsData.adAudioUrl}${cacheBuster}` : null,
          adSegments: adData.segments
        }
      }));

      // 평가 정보 초기화
      const videoMeta = videoMetadata[selectedFile.name] || {};
      await initializeRatings(videoId, adData.segments, {
        fileName: selectedFile.name,
        duration: videoMeta.duration,
        width: videoMeta.width,
        height: videoMeta.height
      });

      setAdGenerationStep('done');
      setPreviewTab('ad'); // 완료 후 AD 탭으로 전환
      
      // 크레딧 새로고침 (차감 반영)
      if (isAuthenticated) {
        refreshCredits();
      }

    } catch (err) {
      console.error('[UploadPage] AD/TTS generation error:', err);
      setAdGenerationError(err.message);
    } finally {
      setAdGenerating(false);
    }
  };

  // 시간 포맷팅 헬퍼 함수
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  };
  
  // 영상 해당 시간으로 이동
  const handleSeekToTime = (seconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {}); // 자동 재생 시도 (실패해도 무시)
    }
  };

  // 평가 정보 초기화 (AD 생성 완료 후 호출)
  const initializeRatings = async (videoId, segments, videoInfo) => {
    try {
      const ratingsPayload = {
        videoInfo: videoInfo || {},
        segments: segments.map(seg => ({
          id: seg.id || seg.index,
          start: seg.start,
          end: seg.end,
          text: seg.text || seg.description || '',
          rating: 'neutral'
        })),
        version: 'original'
      };

      console.log('[UploadPage] Initializing ratings:', ratingsPayload);

      const res = await fetch(`/api/ratings/${videoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ratingsPayload)
      });

      if (!res.ok) {
        console.error('[UploadPage] Failed to initialize ratings:', await res.text());
        return;
      }

      const data = await res.json();
      console.log('[UploadPage] Ratings initialized:', data);

      // 로컬 state에도 반영
      const fileName = selectedFile?.name;
      if (fileName) {
        const initialRatings = {};
        segments.forEach(seg => {
          initialRatings[seg.id || seg.index] = 'neutral';
        });
        setSegmentRatings(prev => ({
          ...prev,
          [fileName]: initialRatings
        }));
      }
    } catch (err) {
      console.error('[UploadPage] Error initializing ratings:', err);
    }
  };

  // 개별 세그먼트 평가 업데이트
  const handleRatingChange = async (segmentId, newRating) => {
    if (!selectedFile) return;

    const uploadInfo = uploading[selectedFile.name];
    if (!uploadInfo?.videoId) {
      console.warn('[UploadPage] No videoId for rating update');
      return;
    }

    const videoId = uploadInfo.videoId;
    const fileName = selectedFile.name;

    // 로컬 state 즉시 업데이트 (낙관적 업데이트)
    setSegmentRatings(prev => ({
      ...prev,
      [fileName]: {
        ...(prev[fileName] || {}),
        [segmentId]: newRating
      }
    }));

    try {
      const res = await fetch(`/api/ratings/${videoId}/segment/${segmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          rating: newRating,
          version: 'original'
        })
      });

      if (!res.ok) {
        console.error('[UploadPage] Failed to update rating:', await res.text());
        // 실패 시 롤백 (선택적)
        return;
      }

      const data = await res.json();
      console.log('[UploadPage] Rating updated:', data);
    } catch (err) {
      console.error('[UploadPage] Error updating rating:', err);
    }
  };

  // 현재 세그먼트의 평가 상태 가져오기
  const getSegmentRating = (segmentId) => {
    if (!selectedFile) return 'neutral';
    return segmentRatings[selectedFile.name]?.[segmentId] || 'neutral';
  };

  const handleFileChange = async (event) => {
    const newFiles = Array.from(event.target.files ?? []).map((file) => ({
      file,
      name: file.name,
      size: file.size,
      preview: URL.createObjectURL(file)
    }));
    if (newFiles.length === 0) return;
    
    // Extract metadata and generate thumbnails for new files
    const metadataPromises = newFiles.map(async (fileObj) => {
      try {
        const [metadata, thumbnail] = await Promise.all([
          extractVideoMetadata(fileObj.file),
          generateThumbnail(fileObj.file)
        ]);
        return { fileObj, metadata, thumbnail };
      } catch (error) {
        console.error('Error extracting metadata/thumbnail:', error);
        // Return defaults on error
        return {
          fileObj,
          metadata: { duration: 0, width: 0, height: 0, fps: 30 },
          thumbnail: null
        };
      }
    });

    const results = await Promise.all(metadataPromises);
    
    // Store metadata and thumbnails by file name
    const newMetadata = { ...videoMetadata };
    const newThumbnails = { ...thumbnails };
    results.forEach(({ fileObj, metadata, thumbnail }) => {
      newMetadata[fileObj.name] = metadata;
      if (thumbnail) {
        newThumbnails[fileObj.name] = thumbnail;
      }
    });
    setVideoMetadata(newMetadata);
    setThumbnails(newThumbnails);
    
    setFiles((prev) => [...prev, ...newFiles]);
    setSelectedIndex(files.length);

    // Upload files to server immediately
    for (const fileObj of newFiles) {
      try {
        await handleUploadFile(fileObj.file);
      } catch (err) {
        // Error already logged and stored in uploading state
        console.warn('[UploadPage] File upload failed, continuing with local file:', fileObj.name);
      }
    }
  };

  const triggerFileDialog = () => fileInputRef.current?.click();

  // YouTube URL 제출 핸들러
  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl.trim()) {
      setYoutubeError('YouTube URL을 입력해주세요.');
      return;
    }

    // YouTube URL 유효성 검사
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/;
    if (!youtubeRegex.test(youtubeUrl)) {
      setYoutubeError('유효한 YouTube URL이 아닙니다.');
      return;
    }

    setYoutubeLoading(true);
    setYoutubeError(null);

    try {
      console.log('[UploadPage] Downloading YouTube video:', youtubeUrl);
      
      const response = await fetch('/api/upload-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl })
      });

      const payload = await response.json().catch(() => null);
      
      if (!response.ok || !payload) {
        throw new Error(payload?.message || 'YouTube 다운로드에 실패했습니다.');
      }

      console.log('[UploadPage] YouTube download success:', payload);

      // 파일 목록에 추가
      const youtubeFile = {
        name: payload.sourceFileName || 'YouTube Video.mp4',
        size: payload.fileSize || 0,
        preview: payload.fileUrl,
        serverUrl: payload.fileUrl,
        isYoutube: true
      };

      setFiles((prev) => [...prev, youtubeFile]);
      setSelectedIndex(files.length);

      // 업로드 상태 저장
      setUploading((prev) => ({
        ...prev,
        [youtubeFile.name]: {
          uploading: false,
          error: null,
          uploaded: true,
          videoId: payload.id || payload.videoId,
          serverPath: payload.serverPath || payload.sourceDiskPath,
          originalVideoUrl: payload.fileUrl
        }
      }));

      // 메타데이터 저장
      setVideoMetadata((prev) => ({
        ...prev,
        [youtubeFile.name]: {
          duration: payload.duration || 0,
          width: 1920,
          height: 1080,
          fps: 30
        }
      }));

      // URL 초기화
      setYoutubeUrl('');
      
    } catch (err) {
      console.error('[UploadPage] YouTube download error:', err);
      setYoutubeError(err.message);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const handleNavigateToEditor = async () => {
    if (files.length === 0) {
      alert('업로드된 파일이 없습니다. 먼저 파일을 추가해주세요.');
      return;
    }
    
    const selectedFile = files[selectedIndex];
    if (!selectedFile) {
      alert('선택된 파일이 없습니다.');
      return;
    }

    // adResults에서 adSegments 가져오기 (AD 생성 결과가 있는 경우)
    const adResult = adResults[selectedFile.name];
    let adScriptSegments = [];
    
    // 초 단위 숫자를 HH:MM:SS.FF 형식으로 변환
    const secondsToTimecode = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const frames = Math.floor((seconds % 1) * 30); // 30fps 가정
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
    };
    
    if (adResult?.adSegments && adResult.adSegments.length > 0) {
      // AD 생성 결과가 있으면 해당 세그먼트 사용
      adScriptSegments = adResult.adSegments.map((seg, index) => ({
        id: seg.id || index + 1,
        startTime: secondsToTimecode(seg.start), // HH:MM:SS.FF 형식으로 변환
        endTime: secondsToTimecode(seg.end),     // HH:MM:SS.FF 형식으로 변환
        text: seg.text
      }));
    }

    // Get real metadata and thumbnail for selected file
    const meta = videoMetadata[selectedFile.name] || { duration: 0, width: 0, height: 0, fps: 30 };
    const thumbnailUrl = thumbnails[selectedFile.name] || null;

    // Get upload info from state (file was already uploaded in handleFileChange)
    const uploadInfo = uploading[selectedFile.name];
    let videoId = null;
    let serverPath = null;
    let originalVideoUrl = null;

    if (uploadInfo?.uploaded) {
      videoId = uploadInfo.videoId;
      serverPath = uploadInfo.serverPath;
      originalVideoUrl = uploadInfo.originalVideoUrl;
      console.log('[UploadPage] Using uploaded file info:', { videoId, serverPath, originalVideoUrl });
    } else if (uploadInfo?.uploading) {
      // Still uploading - wait a bit or show error
      alert('파일이 아직 업로드 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    } else if (uploadInfo?.error) {
      // Upload failed - ask user if they want to continue without AD generation
      const continueWithoutUpload = confirm(
        `업로드 실패: ${uploadInfo.error}\n\n` +
        '서버 업로드 없이 로컬 파일로 편집을 계속하시겠습니까? (AD 생성 기능은 사용할 수 없습니다.)'
      );
      if (!continueWithoutUpload) {
        return;
      }
    } else {
      // Not uploaded yet - try to upload now
      try {
        const result = await handleUploadFile(selectedFile.file);
        videoId = result.videoId;
        serverPath = result.serverPath;
        originalVideoUrl = result.originalVideoUrl;
      } catch (err) {
        const continueWithoutUpload = confirm(
          `업로드 실패: ${err.message}\n\n` +
          '서버 업로드 없이 로컬 파일로 편집을 계속하시겠습니까? (AD 생성 기능은 사용할 수 없습니다.)'
        );
        if (!continueWithoutUpload) {
          return;
        }
      }
    }

    // Pass real file metadata into /video-editor
    // This includes: name, src (blob URL or HTTP URL), sizeBytes, duration, width, height, fps, thumbnailUrl
    // If uploaded to server, also includes: id, serverPath (for AD generation), originalUrl (HTTP URL)
    const videoData = {
      name: selectedFile.name,
      src: originalVideoUrl || selectedFile.preview, // Use HTTP URL if available, otherwise blob URL
      sizeBytes: selectedFile.size,
      duration: meta.duration, // seconds
      width: meta.width,
      height: meta.height,
      fps: meta.fps ?? 30,
      thumbnailUrl: thumbnailUrl, // Generated from first frame if available
      ...(videoId && { id: videoId }), // Only include if uploaded
      ...(serverPath && { serverPath: serverPath }), // Only include if uploaded (backend-only)
      ...(originalVideoUrl && { originalUrl: originalVideoUrl }) // HTTP URL for video playback
    };

    // router state로 데이터 전달
    // TTS가 완료된 경우 adVideoUrl, adAudioUrl도 함께 전달
    navigate('/video-editor', {
      state: {
        video: videoData,
        adScript: adScriptSegments,
        // TTS 적용된 영상/오디오 URL (있는 경우)
        adVideoUrl: adResult?.adVideoUrl || null,
        adAudioUrl: adResult?.adAudioUrl || null
      }
    });
  };

  const selectedFile = files[selectedIndex];

  const adResult = selectedFile ? adResults[selectedFile.name] : null;

  return (
    <section className="workspacePage workspacePage--upload">
      {/* AD/TTS 생성 로딩 오버레이 */}
      {adGenerating && (
        <div className="ad-loading-overlay">
          <div className="ad-loading-modal">
            <div className={`ad-loading-spinner ${adGenerationStep === 'tts' ? 'ad-loading-spinner--tts' : ''}`} />
            <div className="ad-loading-message">
              {adGenerationStep === 'ad' && (
                <>
                  화면해설(AD)을 생성하는 중입니다...<br />
                  <span className="ad-loading-submessage">영상을 분석하여 AD 스크립트를 작성합니다.</span>
                </>
              )}
              {adGenerationStep === 'tts' && (
                <>
                  TTS 음성을 생성하는 중입니다...<br />
                  <span className="ad-loading-submessage">AD 스크립트를 음성으로 변환하고 영상에 합성합니다.</span>
                </>
              )}
            </div>
            <div className="ad-loading-steps">
              <div className={`ad-loading-step ${adGenerationStep === 'ad' ? 'is-active' : ''} ${adGenerationStep === 'tts' || adGenerationStep === 'done' ? 'is-done' : ''}`}>
                <span className="step-number">1</span>
                <span className="step-label">AD 생성</span>
              </div>
              <div className="ad-loading-step-connector" />
              <div className={`ad-loading-step ${adGenerationStep === 'tts' ? 'is-active' : ''} ${adGenerationStep === 'done' ? 'is-done' : ''}`}>
                <span className="step-number">2</span>
                <span className="step-label">TTS 변환</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4"
        multiple
        hidden
        onChange={handleFileChange}
      />
      <div className="uploadToolbar">
        {isAuthenticated && (
          <div className="workspaceHeader__credits" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(255, 193, 7, 0.15)',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#ffc107'
          }}>
            <span>🪙</span>
            <span style={{ fontWeight: '600' }}>
              {authLoading ? '...' : (credits !== null ? credits.toFixed(2) : '0.00')}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
              (1회 생성: 9.98)
            </span>
          </div>
        )}
        <button 
          className="workspaceHeader__cta workspaceHeader__cta--primary" 
          onClick={handleGenerateADAndTTS}
          disabled={!selectedFile || !uploading[selectedFile?.name]?.uploaded || adGenerating}
        >
          🎬 화면해설 생성하기
        </button>
        <button className="workspaceHeader__cta" onClick={handleNavigateToEditor}>
          동영상 편집 이동
        </button>
      </div>
      {adGenerationError && (
        <div style={{
          margin: '16px',
          padding: '12px 16px',
          background: '#ff4444',
          color: '#fff',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          <strong>화면해설 생성 오류:</strong> {adGenerationError}
        </div>
      )}
      {uploadError && (
        <div style={{
          margin: '16px',
          padding: '12px 16px',
          background: '#ff4444',
          color: '#fff',
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          <strong>업로드 오류:</strong> {uploadError}
        </div>
      )}

      <div className="uploadStage">
        <aside className={`uploadSidebar ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}>
          <button className="uploadSidebar__toggle" onClick={() => setSidebarOpen((prev) => !prev)}>
            {sidebarOpen ? '〈' : '〉'}
          </button>
          {sidebarOpen ? (
            <>
              <div className="uploadSidebar__header">
                <div className="uploadQueueBadge">
                  📹 <span>{files.length}</span>
                </div>
              </div>
              
              {/* 입력 소스 탭 */}
              <div className="uploadSidebar__tabs">
                <button 
                  className={`uploadSidebar__tab ${inputSourceTab === 'file' ? 'is-active' : ''}`}
                  onClick={() => setInputSourceTab('file')}
                >
                  📁 파일 업로드
                </button>
                <button 
                  className={`uploadSidebar__tab ${inputSourceTab === 'youtube' ? 'is-active' : ''}`}
                  onClick={() => setInputSourceTab('youtube')}
                >
                  ▶️ YouTube URL
                </button>
              </div>

              {/* 파일 업로드 탭 */}
              {inputSourceTab === 'file' && (
                <div className="workspaceInput">
                  <div className="workspaceDropzone workspaceDropzone--solid" onClick={triggerFileDialog}>
                    <span>파일 추가</span>
                    <small>mp4 · drag & drop 지원</small>
                  </div>
                </div>
              )}

              {/* YouTube URL 탭 */}
              {inputSourceTab === 'youtube' && (
                <div className="uploadSidebar__youtube">
                  <div className="uploadSidebar__youtubeInput">
                    <input
                      type="text"
                      placeholder="https://youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
                      disabled={youtubeLoading}
                    />
                    <button 
                      onClick={handleYoutubeSubmit}
                      disabled={youtubeLoading || !youtubeUrl.trim()}
                    >
                      {youtubeLoading ? '...' : '추가'}
                    </button>
                  </div>
                  {youtubeLoading && (
                    <div className="uploadSidebar__youtubeLoading">
                      <div className="uploadSidebar__youtubeSpinner" />
                      <span>YouTube 영상 다운로드 중...</span>
                    </div>
                  )}
                  {youtubeError && (
                    <div className="uploadSidebar__youtubeError">
                      {youtubeError}
                    </div>
                  )}
                  <p className="uploadSidebar__youtubeHint">
                    YouTube, YouTube Shorts URL 지원
                  </p>
                </div>
              )}

              {/* 업로드 목록 */}
              <div className="workspaceList workspaceList--panel">
                <p className="workspaceList__title">업로드 목록</p>
                {files.length === 0 && <p className="workspaceList__empty">파일을 추가하면 목록이 표시됩니다.</p>}
                <ul>
                  {files.map((item, index) => {
                    const uploadStatus = uploading[item.name];
                    return (
                      <li
                        key={`${item.name}-${index}`}
                        className={index === selectedIndex ? 'is-active' : ''}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div>
                          <strong>
                            {item.isYoutube && '▶️ '}
                            {item.name}
                          </strong>
                          <small>{item.size > 0 ? `${(item.size / (1024 * 1024)).toFixed(1)} MB` : 'YouTube'}</small>
                          {uploadStatus?.uploading && (
                            <small style={{ color: '#3ea6ff', display: 'block', marginTop: '4px' }}>
                              업로드 중...
                            </small>
                          )}
                          {uploadStatus?.uploaded && (
                            <small style={{ color: '#4caf50', display: 'block', marginTop: '4px' }}>
                              ✓ 업로드 완료
                            </small>
                          )}
                          {uploadStatus?.error && (
                            <small style={{ color: '#ff4444', display: 'block', marginTop: '4px' }}>
                              ✗ {uploadStatus.error}
                            </small>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : (
            <div className="uploadSidebar__collapsed">
              <button className="uploadSidebar__collapsedAdd" onClick={triggerFileDialog}>
                +
              </button>
              <div className="uploadSidebar__collapsedQueue">
                📹 <span>{files.length}</span>
              </div>
            </div>
          )}
        </aside>

        <div className="uploadCanvas">
          <div className="workspacePreview workspacePreview--main">
            <div className="previewTabs">
              <button
                className={previewTab === 'original' ? 'is-active' : ''}
                onClick={() => setPreviewTab('original')}
              >
                📹 원본 영상
              </button>
              <button 
                className={`${previewTab === 'ad' ? 'is-active' : ''} ${adResult?.adVideoUrl ? 'has-content' : ''}`} 
                onClick={() => setPreviewTab('ad')}
              >
                🔊 화면해설 적용 영상
                {adResult?.adVideoUrl && <span className="tab-badge">✓</span>}
              </button>
            </div>
            {selectedFile ? (
              previewTab === 'original' ? (
                <video 
                  ref={videoRef}
                  controls 
                  src={selectedFile.preview || uploading[selectedFile.name]?.originalVideoUrl} 
                  key={`original-${selectedFile.name}`} 
                />
              ) : (
                adResult?.adVideoUrl ? (
                  <div className="videoPreviewWithDownload">
                    <video 
                      ref={videoRef}
                      controls 
                      src={adResult.adVideoUrl} 
                      key={`ad-${selectedFile.name}-${adResult.adVideoUrl}`}
                    />
                    <div className="downloadButtonGroup">
                      <a 
                        href={adResult.adVideoUrl} 
                        download={`${selectedFile.name.replace(/\.[^/.]+$/, '')}_AD.mp4`}
                        className="downloadButton downloadButton--primary"
                      >
                        📥 영상 다운로드 (MP4)
                      </a>
                      {adResult?.adAudioUrl && (
                        <a 
                          href={adResult.adAudioUrl} 
                          download={`${selectedFile.name.replace(/\.[^/.]+$/, '')}_AD.wav`}
                          className="downloadButton downloadButton--secondary"
                        >
                          🔊 오디오 다운로드 (WAV)
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="previewPlaceholder">
                    <p>화면해설이 포함된 결과 영상이 여기에 나타납니다.</p>
                    <small>위의 "화면해설 생성하기" 버튼을 클릭하세요.</small>
                  </div>
                )
              )
            ) : (
              <div className="workspacePlaceholder">
                <p>선택된 영상이 없습니다.</p>
                <small>왼쪽 사이드바에서 파일을 추가해 주세요.</small>
              </div>
            )}
          </div>
          <aside className={`uploadScriptPanel ${scriptOpen ? 'is-open' : 'is-collapsed'}`}>
            <button className="uploadScriptPanel__toggle" onClick={() => setScriptOpen((prev) => !prev)}>
              {scriptOpen ? '◀' : '▶'}
            </button>
            {scriptOpen && (
              <>
                {/* AD가 생성되지 않은 경우: 설정 패널 표시 */}
                {!adResult?.adSegments || adResult.adSegments.length === 0 ? (
                  <>
                    <div className="uploadScriptPanel__header">
                      <h3 className="uploadScriptPanel__title">화면해설 설정</h3>
                      <span className="uploadScriptPanel__badge">설정</span>
                    </div>
                    <div className="uploadScriptPanel__content">
                      <div className="uploadSettingsPanel">
                        {/* 모델 선택 섹션 */}
                        <div className="uploadSettingsPanel__section">
                          <label className="uploadSettingsPanel__label">
                            <span className="uploadSettingsPanel__icon">🤖</span>
                            AI 모델 선택
                          </label>
                          <div className="uploadSettingsPanel__options">
                            <button
                              className={`uploadSettingsPanel__option ${selectedModel === 'gpt' ? 'is-active' : ''}`}
                              onClick={() => setSelectedModel('gpt')}
                            >
                              <span className="uploadSettingsPanel__optionIcon">🧠</span>
                              <div className="uploadSettingsPanel__optionText">
                                <strong>GPT-4o</strong>
                                <small>OpenAI의 최신 멀티모달 모델</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__option ${selectedModel === 'gemini' ? 'is-active' : ''}`}
                              onClick={() => setSelectedModel('gemini')}
                            >
                              <span className="uploadSettingsPanel__optionIcon">🪙</span>
                              <div className="uploadSettingsPanel__optionText">
                                <strong>Gemini 3.0</strong>
                                <small>Google의 최신 AI 모델</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__option ${selectedModel === 'jack' ? 'is-active' : ''}`}
                              onClick={() => setSelectedModel('jack')}
                            >
                              <span className="uploadSettingsPanel__optionIcon">🎯</span>
                              <div className="uploadSettingsPanel__optionText">
                                <strong>Jack (앙상블)</strong>
                                <small>다중 온도 앙상블로 최고 품질</small>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* 언어 선택 섹션 */}
                        <div className="uploadSettingsPanel__section">
                          <label className="uploadSettingsPanel__label">
                            <span className="uploadSettingsPanel__icon">🌐</span>
                            출력 언어
                          </label>
                          <div className="uploadSettingsPanel__langGrid">
                            <button
                              className={`uploadSettingsPanel__lang ${selectedLang === 'ko' ? 'is-active' : ''}`}
                              onClick={() => setSelectedLang('ko')}
                            >
                              🇰🇷 한국어
                            </button>
                            <button
                              className={`uploadSettingsPanel__lang ${selectedLang === 'en' ? 'is-active' : ''}`}
                              onClick={() => setSelectedLang('en')}
                            >
                              🇺🇸 English
                            </button>
                            <button
                              className={`uploadSettingsPanel__lang ${selectedLang === 'ja' ? 'is-active' : ''}`}
                              onClick={() => setSelectedLang('ja')}
                            >
                              🇯🇵 日本語
                            </button>
                            <button
                              className={`uploadSettingsPanel__lang ${selectedLang === 'zh' ? 'is-active' : ''}`}
                              onClick={() => setSelectedLang('zh')}
                            >
                              🇨🇳 中文
                            </button>
                          </div>
                        </div>

                        {/* TTS 음성 프로필 선택 섹션 */}
                        <div className="uploadSettingsPanel__section">
                          <label className="uploadSettingsPanel__label">
                            <span className="uploadSettingsPanel__icon">🎙️</span>
                            TTS 음성 프로필
                          </label>
                          <div className="uploadSettingsPanel__voiceGrid">
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'gtts' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('gtts')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">🔊</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>기본 음성</strong>
                                <small>Google TTS (빠름)</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'kor_male' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('kor_male')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👨🏻</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>한국어 남성</strong>
                                <small>자연스러운 남성 음성</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'kor_female' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('kor_female')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👩🏻</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>한국어 여성</strong>
                                <small>자연스러운 여성 음성</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'eng_male' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('eng_male')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👨🏼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>영어 남성</strong>
                                <small>Natural male voice</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'eng_female' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('eng_female')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👩🏼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>영어 여성</strong>
                                <small>Natural female voice</small>
                              </div>
                            </button>
                          </div>
                          
                          {/* Gemini TTS 옵션 */}
                          <label className="uploadSettingsPanel__label" style={{ marginTop: '1rem' }}>
                            <span className="uploadSettingsPanel__icon">✨</span>
                            Gemini TTS (Google AI)
                          </label>
                          <div className="uploadSettingsPanel__voiceGrid">
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'gemini_kor_female' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('gemini_kor_female')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👩🏻‍💼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>한국어 여성</strong>
                                <small>Gemini Kore</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'gemini_kor_male' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('gemini_kor_male')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👨🏻‍💼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>한국어 남성</strong>
                                <small>Gemini Puck</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'gemini_eng_female' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('gemini_eng_female')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👩🏼‍💼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>영어 여성</strong>
                                <small>Gemini Aoede</small>
                              </div>
                            </button>
                            <button
                              className={`uploadSettingsPanel__voice ${selectedVoiceProfile === 'gemini_eng_male' ? 'is-active' : ''}`}
                              onClick={() => setSelectedVoiceProfile('gemini_eng_male')}
                            >
                              <span className="uploadSettingsPanel__voiceIcon">👨🏼‍💼</span>
                              <div className="uploadSettingsPanel__voiceText">
                                <strong>영어 남성</strong>
                                <small>Gemini Charon</small>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* 더킹 설정 섹션 */}
                        <div className="uploadSettingsPanel__section">
                          <label className="uploadSettingsPanel__label">
                            <span className="uploadSettingsPanel__icon">🔉</span>
                            오디오 믹싱
                          </label>
                          <div className="uploadSettingsPanel__toggle">
                            <label className="uploadSettingsPanel__checkbox">
                              <input
                                type="checkbox"
                                checked={enableDucking}
                                onChange={(e) => setEnableDucking(e.target.checked)}
                              />
                              <span className="uploadSettingsPanel__checkboxLabel">
                                스마트 더킹 활성화
                              </span>
                            </label>
                            <p className="uploadSettingsPanel__toggleDesc">
                              대사와 AD가 겹칠 때 AD 볼륨을 자동으로 줄여 대사가 더 잘 들리게 합니다.
                            </p>
                          </div>
                        </div>

                        {/* 안내 메시지 */}
                        <div className="uploadSettingsPanel__info">
                          <p>
                            <strong>💡 사용 안내</strong>
                          </p>
                          <ul>
                            <li>GPT-4o: 상세하고 자연스러운 화면해설</li>
                            <li>Gemini 2.0: 빠른 처리와 정확한 장면 인식</li>
                            <li>Jack 앙상블: 최고 품질 (메타데이터 검증 + 다중 온도)</li>
                            <li>기본 음성: 빠른 처리 (Google TTS)</li>
                            <li>고급 음성: 자연스러운 음성 (Coqui XTTS)</li>
                            <li>Gemini TTS: Google AI 기반 고품질 음성</li>
                          </ul>
                          <p className="uploadSettingsPanel__hint">
                            설정 완료 후 상단의<br />
                            "🎬 화면해설 생성하기" 버튼을 클릭하세요.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  /* AD가 생성된 경우: 스크립트 표시 */
                  <>
                    <div className="uploadScriptPanel__header">
                      <h3 className="uploadScriptPanel__title">AD Script</h3>
                      <span className="uploadScriptPanel__badge">읽기 전용</span>
                    </div>
                    <div className="uploadScriptPanel__content">
                      {adResult.adSegments.map((segment, index) => {
                        const segmentId = segment.id || index + 1;
                        const currentRating = getSegmentRating(segmentId);
                        
                        return (
                          <div key={segmentId} className="uploadScriptPanel__segment">
                            <div className="uploadScriptPanel__segmentHeader">
                              <div className="uploadScriptPanel__timeRange">
                                <button 
                                  className="uploadScriptPanel__timeButton"
                                  onClick={() => handleSeekToTime(segment.start)}
                                  title="이 시간으로 이동"
                                >
                                  {formatTime(segment.start)}
                                </button>
                                <span className="uploadScriptPanel__timeSeparator">–</span>
                                <button 
                                  className="uploadScriptPanel__timeButton"
                                  onClick={() => handleSeekToTime(segment.end)}
                                  title="이 시간으로 이동"
                                >
                                  {formatTime(segment.end)}
                                </button>
                              </div>
                              <div className="uploadScriptPanel__ratingButtons">
                                <button
                                  className={`uploadScriptPanel__ratingBtn uploadScriptPanel__ratingBtn--like ${currentRating === 'like' ? 'is-active' : ''}`}
                                  onClick={() => handleRatingChange(segmentId, currentRating === 'like' ? 'neutral' : 'like')}
                                  title="좋아요"
                                >
                                  👍
                                </button>
                                <button
                                  className={`uploadScriptPanel__ratingBtn uploadScriptPanel__ratingBtn--dislike ${currentRating === 'dislike' ? 'is-active' : ''}`}
                                  onClick={() => handleRatingChange(segmentId, currentRating === 'dislike' ? 'neutral' : 'dislike')}
                                  title="싫어요"
                                >
                                  👎
                                </button>
                              </div>
                            </div>
                            <div className="uploadScriptPanel__text">{segment.text}</div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

