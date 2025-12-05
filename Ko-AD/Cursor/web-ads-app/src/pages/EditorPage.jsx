import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoTimeline from '../components/VideoTimeline';

const baseTimeline = [
  { label: '인트로', start: 0, duration: 8, ad: '깊은 숲속에서 안개가 피어오릅니다.' },
  { label: '대사', start: 8, duration: 12, ad: '주인공이 동료를 구하며 긴박한 상황을 설명합니다.' },
  { label: '무음1', start: 20, duration: 6, ad: '조용한 순간에 등장 인물의 표정만 클로즈업됩니다.' },
  { label: 'AD', start: 26, duration: 5, ad: '“지금 전투 화면이 보입니다. 거대한 보스가 하늘을 가릅니다.”' }
];

const silentSegmentsSeed = [
  {
    id: 1,
    label: '장면 23',
    start: '00:23',
    end: '00:30',
    text: '남자가 다른 한 남자를 향해 걸어가고 있다.'
  },
  {
    id: 2,
    label: '장면 24',
    start: '00:31',
    end: '00:36',
    text: '전광판에 번쩍이는 광고 문구가 나타난다.'
  },
  {
    id: 3,
    label: '장면 25',
    start: '00:37',
    end: '00:41',
    text: '카메라가 위로 올라가며 야경을 비춘다.'
  }
];

// 비디오 길이를 시:분:초 형식으로 변환 (임시로 파일 크기 기반 추정)
const formatDuration = (sizeInBytes) => {
  // 임시: 파일 크기로 대략적인 길이 추정 (1MB ≈ 1분 가정)
  const totalMB = sizeInBytes / (1024 * 1024);
  const totalMinutes = Math.floor(totalMB);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const secs = Math.floor((totalMB % 1) * 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function EditorPage() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [clips, setClips] = useState(baseTimeline);
  const [activeClip, setActiveClip] = useState(0);
  const [segments, setSegments] = useState(silentSegmentsSeed);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // localStorage에서 업로드된 파일 목록 읽기
    const savedFiles = localStorage.getItem('ko-ad-uploaded-files');
    const savedIndex = localStorage.getItem('ko-ad-selected-index');
    
    console.log('EditorPage mounted, checking localStorage...');
    console.log('savedFiles:', savedFiles);
    console.log('savedIndex:', savedIndex);
    
    if (savedFiles) {
      try {
        const filesData = JSON.parse(savedFiles);
        console.log('Parsed files data:', filesData);
        console.log('Files count:', filesData.length);
        
        if (filesData.length > 0) {
          setUploadedFiles(filesData);
          
          // 인덱스 설정
          if (savedIndex !== null && savedIndex !== undefined) {
            const index = parseInt(savedIndex, 10);
            console.log('Parsed index:', index);
            if (!isNaN(index) && index >= 0 && index < filesData.length) {
              console.log('Setting selected index to:', index);
              setSelectedFileIndex(index);
            } else {
              console.log('Invalid index, defaulting to 0');
              setSelectedFileIndex(0);
            }
          } else {
            console.log('No saved index, defaulting to 0');
            setSelectedFileIndex(0);
          }
        } else {
          console.log('No files in saved data');
        }
      } catch (e) {
        console.error('Failed to parse saved files:', e);
      }
    } else {
      console.log('No saved files found in localStorage');
    }
  }, []);

  // selectedFile 계산
  const selectedFile = uploadedFiles.length > 0 && selectedFileIndex >= 0 && selectedFileIndex < uploadedFiles.length
    ? uploadedFiles[selectedFileIndex]
    : null;

  useEffect(() => {
    console.log('=== EditorPage State Update ===');
    console.log('uploadedFiles:', uploadedFiles);
    console.log('uploadedFiles.length:', uploadedFiles.length);
    console.log('selectedFileIndex:', selectedFileIndex);
    console.log('selectedFile:', selectedFile);
    if (selectedFile) {
      console.log('selectedFile.preview:', selectedFile.preview);
      console.log('selectedFile.name:', selectedFile.name);
    }
    // 파일이 변경되면 에러 상태 초기화 및 시간 초기화
    setVideoError(false);
    setCurrentTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, [selectedFile, uploadedFiles, selectedFileIndex]);

  const total = useMemo(() => clips.reduce((acc, clip) => Math.max(acc, clip.start + clip.duration), 0), [clips]);

  const handleTrim = () => {
    setClips((prev) =>
      prev.map((clip, index) => (index === activeClip ? { ...clip, duration: Math.max(clip.duration - 1, 2) } : clip))
    );
  };

  const handleSegmentChange = (id, value) => {
    setSegments((prev) => prev.map((segment) => (segment.id === id ? { ...segment, text: value } : segment)));
  };

  return (
    <section className="workspacePage">
      <div className="workspaceHeader">
        <div>
          <p className="section__eyebrow">Step 02</p>
          <h1>동영상 편집</h1>
          <p className="section__description">
            자동으로 제안된 타임라인을 검토하고, 필요하면 구간 길이를 조정하거나 AD 구간을 편집하세요.
          </p>
        </div>
        <div className="workspaceHeader__actions">
          <button className="workspaceButton workspaceButton--ghost" onClick={() => navigate('/upload')}>
            편집 취소
          </button>
          <button className="workspaceButton workspaceButton--primary" onClick={() => alert('편집 내용이 저장되었습니다.')}>
            완료
          </button>
        </div>
      </div>

      <div className="workspaceLayout workspaceLayout--editor">
        <aside className="workspaceSidebar">
          <p className="workspaceList__title">입력 파일</p>
          <div className="workspaceList workspaceList--compact">
            {uploadedFiles.length === 0 ? (
              <p className="workspaceList__empty">업로드된 파일이 없습니다.</p>
            ) : (
              <ul>
                {uploadedFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className={index === selectedFileIndex ? 'is-active' : ''}
                    onClick={() => {
                      console.log('File clicked:', file.name, 'index:', index);
                      setSelectedFileIndex(index);
                    }}
                  >
                    <div>
                      <strong>{file.name}</strong>
                      <small>{formatDuration(file.size)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="workspaceButton workspaceButton--ghost" onClick={handleTrim}>
            선택된 구간 1초 줄이기
          </button>
        </aside>

        <div className="workspaceMain">
          <div className="workspacePreview workspacePreview--editor">
            {selectedFile && selectedFile.preview ? (
              <>
                {!videoError ? (
                  <video
                    ref={videoRef}
                    key={`${selectedFile.preview}-${selectedFileIndex}`}
                    controls
                    src={selectedFile.preview}
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: '520px',
                      borderRadius: '16px',
                      display: 'block'
                    }}
                    onError={(e) => {
                      console.error('Video load error:', e);
                      console.error('Failed video src:', selectedFile.preview);
                      console.error('Selected file:', selectedFile);
                      setVideoError(true);
                    }}
                    onLoadedData={() => {
                      console.log('✅ Video loaded successfully:', selectedFile.name);
                      console.log('Video src:', selectedFile.preview);
                      setVideoError(false);
                    }}
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        setVideoDuration(videoRef.current.duration);
                        console.log('Video duration:', videoRef.current.duration);
                      }
                    }}
                    onTimeUpdate={() => {
                      if (videoRef.current) {
                        setCurrentTime(videoRef.current.currentTime);
                      }
                    }}
                    onLoadStart={() => {
                      console.log('🔄 Video loading started:', selectedFile.name);
                      setVideoError(false);
                    }}
                  />
                ) : (
                  <div className="workspacePlaceholder" style={{ padding: '2rem' }}>
                    <p style={{ color: '#ef4444', marginBottom: '1rem' }}>⚠️ 영상을 불러올 수 없습니다</p>
                    <small style={{ display: 'block', marginBottom: '1rem' }}>
                      Blob URL이 만료되었거나 파일에 접근할 수 없습니다.
                      <br />
                      업로드 페이지로 돌아가서 파일을 다시 업로드해주세요.
                    </small>
                    <button
                      className="workspaceButton workspaceButton--primary"
                      onClick={() => navigate('/upload')}
                      style={{ marginTop: '1rem' }}
                    >
                      업로드 페이지로 이동
                    </button>
                  </div>
                )}
                {!videoError && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'rgba(248, 250, 252, 0.6)', textAlign: 'center' }}>
                    {selectedFile.name}
                  </div>
                )}
              </>
            ) : (
              <div className="workspacePlaceholder">
                <p>편집 미리보기</p>
                <small>
                  {uploadedFiles.length === 0
                    ? '업로드 페이지에서 파일을 업로드한 후 편집 페이지로 이동해주세요.'
                    : selectedFile
                    ? '영상을 불러오는 중...'
                    : '좌측 목록에서 파일 선택 시 영상이 여기 표시됩니다.'}
                </small>
                {process.env.NODE_ENV === 'development' && (
                  <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'rgba(248, 250, 252, 0.4)' }}>
                    Debug: uploadedFiles={uploadedFiles.length}, selectedIndex={selectedFileIndex}, selectedFile={selectedFile ? 'exists' : 'null'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedFile && selectedFile.preview && videoDuration > 0 && (
        <VideoTimeline
          videoSrc={selectedFile.preview}
          duration={videoDuration}
          currentTime={currentTime}
          onSeek={(time) => {
            setCurrentTime(time);
            if (videoRef.current && videoRef.current.readyState >= 2) {
              videoRef.current.currentTime = time;
            }
          }}
        />
      )}
      <div className="adGrid">
        <div className="adPreviewPanel">
          <h3>AD 스크립트</h3>
          <p className="adPreviewPanel__meta">
            선택 구간: {clips[activeClip].label} · {clips[activeClip].duration.toFixed(1)}초
          </p>
          <textarea value={clips[activeClip].ad} readOnly />
          <div className="adPreviewPanel__actions">
            <button type="button" onClick={() => alert('AD 클립 미리보기를 실행합니다.')}>
              재생
            </button>
            <button type="button" onClick={() => alert('AD 문장을 편집하는 기능은 추후 제공됩니다.')}>
              AD 편집
            </button>
          </div>
        </div>
        <div className="adSegments">
          <div className="adSegments__header">
            <div>
              <p className="section__eyebrow">무음 구간</p>
              <h3>AD 편집 리스트</h3>
            </div>
            <button className="textButton" onClick={() => alert('CSV가 곧 생성됩니다.')}>
              CSV 미리보기
            </button>
          </div>
          <ul>
            {segments.map((segment) => (
              <li key={segment.id}>
                <div className="adSegment__title">
                  <strong>{segment.label}</strong>
                  <span>
                    {segment.start} ~ {segment.end}
                  </span>
                </div>
                <textarea value={segment.text} onChange={(event) => handleSegmentChange(segment.id, event.target.value)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

