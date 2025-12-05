export default function PipelineSteps({ steps }) {
  return (
    <section className="section" id="pipeline">
      <div className="section__header">
        <div>
          <p className="section__eyebrow">Step 02 ~ 06</p>
          <h2>자동 AD 생성 파이프라인</h2>
          <p className="section__description">
            Colab에서 구동될 모델 파이프라인과 동일한 순서로 UI 카드를 구성했습니다. 각 단계의 입력/출력 규격을 확장해 추후
            백엔드 API만 연결하면 동일한 UI로 즉시 테스트할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="pipelineGrid">
        {steps.map((step) => (
          <article key={step.title} className="pipelineCard">
            <div className="pipelineCard__icon">{step.emoji}</div>
            <p className="pipelineCard__tag">{step.tag}</p>
            <h3>{step.title}</h3>
            <p className="pipelineCard__subtitle">{step.subtitle}</p>
            <ul>
              {step.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

