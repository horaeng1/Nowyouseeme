import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

const timelineBridge = {
  queued: 'uploading',
  processing: 'analyzing',
  generating: 'generating',
  rendering: 'encoding',
  completed: 'done',
  failed: 'failed'
};

const statusLabel = {
  queued: '큐 대기 중',
  processing: '분석 중',
  generating: 'AD 생성 중',
  rendering: '인코딩 중',
  completed: '다운로드 준비 완료',
  failed: '실패'
};

export default function UploadPanel({ onStatusChange }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'youtube'
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [hint, setHint] = useState('mp4 · 10GB 이하 · 3시간 이하');
  const [jobMeta, setJobMeta] = useState(null);
  const [uploadState, setUploadState] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobMeta?.id) return undefined;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobMeta.id}`);
        if (!res.ok) throw new Error('상태 정보를 불러오지 못했습니다.');
        const data = await res.json();
        setJobMeta(data);
        onStatusChange?.(timelineBridge[data.status] ?? 'uploading');
      } catch (pollError) {
        console.warn('상태 조회 실패', pollError);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [jobMeta?.id, onStatusChange]);

  const uploadToPipeline = async (file) => {
    setUploadState('uploading');
    setError(null);
    setHint('서버로 전송 중입니다...');
    onStatusChange?.('uploading');

    try {
      const formData = new FormData();
      formData.append('video', file);
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.message || '업로드에 실패했습니다.');
      }

      setJobMeta(payload);
      setHint('로컬 파이프라인 큐에 등록되었습니다.');
      onStatusChange?.('uploading');
    } catch (uploadError) {
      console.error(uploadError);
      setError(uploadError.message);
      setHint('업로드 실패. 다시 시도해 주세요.');
      onStatusChange?.('failed');
    } finally {
      setUploadState('idle');
    }
  };

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl) return;

    setUploadState('uploading');
    setError(null);
    setHint('YouTube 영상을 다운로드 중입니다... (시간이 소요될 수 있습니다)');
    onStatusChange?.('uploading');

    try {
      const response = await fetch('/api/upload-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.message || 'YouTube 다운로드에 실패했습니다.');
      }

      setJobMeta(payload);
      setHint('다운로드 완료. 에디터로 이동합니다...');
      onStatusChange?.('uploading');

      // Navigate to editor with video data
      const videoData = {
        name: payload.sourceFileName || 'YouTube Video',
        src: payload.fileUrl, // Use the static file URL from backend
        sizeBytes: 0,
        duration: payload.duration || 0,
        width: 1920, // Default assumption
        height: 1080, // Default assumption
        fps: 30, // Default assumption
        thumbnailUrl: null
      };

      // Initial empty ad script
      const adScript = [];

      // Short delay to show success message
      setTimeout(() => {
        navigate('/video-editor', { state: { video: videoData, adScript } });
      }, 1500);

    } catch (err) {
      console.error(err);
      setError(err.message);
      setHint('다운로드 실패. 다시 시도해 주세요.');
      onStatusChange?.('failed');
      setUploadState('idle');
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE) {
      setHint('파일 용량이 10GB를 초과했습니다.');
      setSelectedFile(null);
      onStatusChange?.('failed');
      return;
    }

    setSelectedFile(file);
    setHint('파이프라인 연결 시 자동으로 큐에 적재됩니다.');
    uploadToPipeline(file);
  };

  const eventCount = jobMeta?.events?.length ?? 0;
  const latestEvent = eventCount ? jobMeta.events[eventCount - 1] : null;

  return (
    <section className="section" id="upload">
      <div className="section__header">
        <div>
          <p className="section__eyebrow">Step 01</p>
          <h2>영상 업로드 & 검증</h2>
          <p className="section__description">
            MVP는 단일 mp4 업로드만 지원합니다. 파이프라인이 준비되면 로컬 스크립트 혹은 추후 배포될 백엔드 워커와 연동할 수 있도록
            입력 규격과 상태 이벤트를 정의해 두었습니다.
          </p>
        </div>
        <button className="textButton" onClick={() => inputRef.current?.click()}>
          업로드 정책 문서 열기
        </button>
      </div>

      <div className="uploadPanel">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <button
            onClick={() => setActiveTab('file')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'file' ? '#333' : 'transparent',
              color: activeTab === 'file' ? '#fff' : '#888',
              border: '1px solid #333',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            파일 업로드
          </button>
          <button
            onClick={() => setActiveTab('youtube')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'youtube' ? '#333' : 'transparent',
              color: activeTab === 'youtube' ? '#fff' : '#888',
              border: '1px solid #333',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            YouTube URL
          </button>
        </div>

        {activeTab === 'file' ? (
          <div className="uploadPanel__dropzone" onClick={() => inputRef.current?.click()}>
            <div className="uploadPanel__bubble">Drag & Drop</div>
            <p className="uploadPanel__title">여기에 영상을 끌어다 놓거나 클릭하세요</p>
            <p className="uploadPanel__hint">{hint}</p>
            <button className="uploadPanel__trigger" disabled={uploadState === 'uploading'}>
              {uploadState === 'uploading' ? '서버로 전송 중...' : 'mp4 파일 선택'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={handleFileChange}
            />
            {selectedFile && (
              <div className="uploadPanel__file">
                <p>{selectedFile.name}</p>
                <span>{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</span>
              </div>
            )}
          </div>
        ) : (
          <div className="uploadPanel__dropzone" style={{ cursor: 'default' }}>
            <div className="uploadPanel__bubble">YouTube</div>
            <p className="uploadPanel__title">YouTube 영상 URL을 입력하세요</p>
            <p className="uploadPanel__hint">{hint}</p>

            {/* Loading Overlay */}
            {uploadState === 'uploading' && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'rgba(0,0,0,0.5)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <div className="spinner" style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid rgba(255,255,255,0.3)',
                  borderRadius: '50%',
                  borderTopColor: '#fff',
                  animation: 'spin 1s ease-in-out infinite'
                }}></div>
                <p style={{ fontSize: '0.9rem', color: '#fff' }}>영상 다운로드 중...</p>
                <style>{`
                   @keyframes spin {
                     to { transform: rotate(360deg); }
                   }
                 `}</style>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', width: '100%', maxWidth: '400px', marginTop: '1rem' }}>
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.8rem',
                  borderRadius: '4px',
                  border: '1px solid #444',
                  background: '#222',
                  color: '#fff'
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleYoutubeSubmit()}
                disabled={uploadState === 'uploading'}
              />
              <button
                className="uploadPanel__trigger"
                onClick={handleYoutubeSubmit}
                disabled={uploadState === 'uploading' || !youtubeUrl}
                style={{ margin: 0 }}
              >
                {uploadState === 'uploading' ? '...' : '확인'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="uploadPanel__error">{error}</p>}

        {jobMeta && (
          <div className="uploadPanel__job">
            <div className="uploadPanel__jobGrid">
              <div>
                <p>작업 ID</p>
                <strong>{jobMeta.id}</strong>
              </div>
              <div>
                <p>현재 상태</p>
                <strong>{statusLabel[jobMeta.status] ?? jobMeta.status}</strong>
                {latestEvent?.note && <small>{latestEvent.note}</small>}
              </div>
              {jobMeta.sourceUrl && (
                <div>
                  <p>입력 파일</p>
                  <a href={jobMeta.sourceUrl} target="_blank" rel="noreferrer">
                    원본 파일 열기
                  </a>
                </div>
              )}
            </div>
            {jobMeta.resultUrl ? (
              <div className="uploadPanel__jobActions">
                <a
                  className="uploadPanel__trigger"
                  href={jobMeta.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  결과 다운로드
                </a>
              </div>
            ) : (
              <p className="uploadPanel__jobNote">파이프라인이 완료되면 다운로드 링크가 활성화됩니다.</p>
            )}
          </div>
        )}

        <div className="uploadPanel__policy">
          <div>
            <p>입력 스펙</p>
            <ul>
              <li>포맷: mp4 (추후 확대)</li>
              <li>길이: 3시간 이하</li>
              <li>용량: 10GB 이하</li>
              <li>손상/코덱 오류 즉시 차단</li>
            </ul>
          </div>
          <div>
            <p>파이프라인 이벤트</p>
            <ul>
              <li>UPLOAD_REQUESTED</li>
              <li>ASSET_VALIDATED</li>
              <li>PIPELINE_ENQUEUED</li>
            </ul>
          </div>
          <div>
            <p>상태 표시</p>
            <ul>
              <li>업로드 중</li>
              <li>분석 중</li>
              <li>AD 생성 중</li>
              <li>인코딩 중</li>
              <li>완료 / 실패</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
