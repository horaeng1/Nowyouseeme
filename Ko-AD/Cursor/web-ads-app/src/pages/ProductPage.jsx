import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Hero from '../components/Hero.jsx';
import PipelineSteps from '../components/PipelineSteps.jsx';
import SpecGrid from '../components/SpecGrid.jsx';
import FaqAccordion from '../components/FaqAccordion.jsx';
import Footer from '../components/Footer.jsx';

const pipelineSteps = [
  {
    emoji: '🎧',
    tag: 'FR-M10 ~ 12',
    title: '음성 분석',
    subtitle: '오디오 트랙 추출 → 한국어 ASR → 무음 탐지',
    items: ['타임스탬프 포함 대본 생성', '무음 구간 길이 정책 적용', 'AD 삽입 후보 슬롯 계산']
  },
  {
    emoji: '🖼️',
    tag: 'FR-M20 ~ 22',
    title: '시각 정보 분석',
    subtitle: '프레임 샘플링 & 시각 특징 추출',
    items: ['객체/행동 감지', '주요 텍스트 OCR', 'AD 생성용 JSON 구조화']
  },
  {
    emoji: '📝',
    tag: 'FR-M30 ~ 33',
    title: 'AD 문장 생성',
    subtitle: '현재 시제 · 객관 묘사 정책',
    items: ['구간 길이 대비 발화 시간 계산', '중복 내용 자동 축약', 'TTS 속도 기준 길이 검증']
  },
  {
    emoji: '🗣️',
    tag: 'FR-M40 ~ 43',
    title: 'TTS 및 오디오 믹싱',
    subtitle: '고정 프리셋 음색 · 겹침 최소화',
    items: ['구간별 AD 음성 생성', '원본 음성 충돌 시 생략/볼륨 조정']
  },
  {
    emoji: '🎬',
    tag: 'FR-M50 ~ 52',
    title: '결과 영상 인코딩',
    subtitle: '새 오디오 트랙으로 mp4 재인코딩',
    items: ['다운로드 URL 발급', '24시간 내 자동 삭제 정책']
  }
];

const faqItems = [
  {
    question: '파이프라인이 아직 없어도 테스트할 수 있나요?',
    answer:
      '예. 현재는 프런트엔드 시뮬레이션 상태지만, 큐 이벤트 명세를 맞춰 두어 로컬 스크립트 또는 백엔드 워커를 쉽게 연결할 수 있습니다.'
  },
  {
    question: '동시 처리 제한은 어떻게 되나요?',
    answer: '초기에는 1~3개의 병렬 처리만 허용하고 나머지는 큐에 쌓습니다. UI에서는 대기열 순번을 노출할 수 있도록 설계했습니다.'
  },
  {
    question: '파일은 언제 삭제되나요?',
    answer: '업로드 파일, 중간 산출물, 결과 영상은 24시간(변경 가능) 후 일괄 삭제됩니다.'
  }
];

export default function ProductPage() {
  const navigate = useNavigate();
  const pipelineRef = useRef(null);
  const faqRef = useRef(null);
  const sectionRefs = {
    upload: null,
    pipeline: pipelineRef,
    faq: faqRef
  };

  const scrollToSection = (key) => {
    if (key === 'upload') {
      navigate('/upload');
      return;
    }
    const ref = sectionRefs[key];
    ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleStart = () => {
    navigate('/upload');
  };

  return (
    <main className="app">
      <Hero onStart={handleStart} onViewPipeline={scrollToSection} colabLink="#" />
      <div className="content">
        {/* 입력 스펙 섹션 */}
        <SpecGrid
          limits={['mp4 단일 업로드', '용량 10GB / 길이 3시간', 'HTTPS 업로드/다운로드', '24시간 후 자동 삭제']}
          nonFunctional={[
            '10분 영상 20분 이내 처리 목표',
            '동시 처리 1~3건, 나머지는 큐 대기',
            '격리 스토리지 & HTTPS 전송',
            '스크린리더 대응 버튼 라벨'
          ]}
          future={[
            'AD 텍스트 편집 & 재합성',
            'AD on/off 지원 플레이어',
            '계정/결제 및 프로젝트 관리',
            '다국어 AD · API · B2B 콘솔'
          ]}
        />
        
        {/* 파이프라인 단계 섹션 */}
        <div ref={pipelineRef}>
          <PipelineSteps steps={pipelineSteps} />
        </div>
        
        {/* FAQ 섹션 */}
        <div ref={faqRef}>
          <FaqAccordion items={faqItems} />
        </div>
      </div>
      <Footer />
    </main>
  );
}

