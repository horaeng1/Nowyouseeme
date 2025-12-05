import './Hero.css';

export default function Hero({ onStart, onViewPipeline, colabLink }) {
  return (
    <header className="hero">
      <nav className="hero__nav">
        <div className="hero__logo">
          <span className="hero__mark" />
          <div>
            <p className="hero__title">AD Mixer</p>
            <p className="hero__tagline">Screen narration studio</p>
          </div>
        </div>
        <div className="hero__navLinks">
          <button onClick={() => onViewPipeline('upload')}>업로드</button>
          <button onClick={() => onViewPipeline('pipeline')}>파이프라인</button>
          <button onClick={() => onViewPipeline('faq')}>FAQ</button>
          <a href={colabLink} target="_blank" rel="noreferrer" className="hero__link">
            Colab
          </a>
        </div>
      </nav>

      <div className="hero__body">
        <div>
          <p className="hero__pill">로그인 없이 화면해설 추가</p>
          <h1>
            업로드 한 번으로
            <br />
            AD 포함 영상 완성
          </h1>
          <p className="hero__subtitle">
            영상 업로드 → 음성·시각 분석 → AD 작성 → TTS/믹싱 → 다운로드까지 한번에.
            Colab 파이프라인과 연동하는 웹 UI MVP입니다.
          </p>

          <div className="hero__cta">
            <button className="hero__btn hero__btn--primary" onClick={onStart}>
              영상 업로드 시작
            </button>
            <button className="hero__btn hero__btn--ghost" onClick={() => onViewPipeline('pipeline')}>
              파이프라인 미리보기
            </button>
          </div>

          <div className="hero__stats">
            <div>
              <p>업로드 한도</p>
              <strong>10GB · 3시간</strong>
            </div>
            <div>
              <p>지원 포맷</p>
              <strong>mp4 (MVP)</strong>
            </div>
            <div>
              <p>처리 방식</p>
              <strong>비회원 · 큐 기반</strong>
            </div>
          </div>
        </div>

        <div className="hero__mockup">
          <div className="hero__screen">
            <div className="hero__screenBar">
              <span />
              <span />
              <span />
            </div>
            <div className="hero__timeline">
              <div className="hero__clip" />
              <div className="hero__clip hero__clip--ghost" />
            </div>
            <div className="hero__steps">
              {['업로드', '분석', 'AD 생성', '인코딩', '다운로드'].map((label) => (
                <div key={label} className="hero__step">
                  <span />
                  <p>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

