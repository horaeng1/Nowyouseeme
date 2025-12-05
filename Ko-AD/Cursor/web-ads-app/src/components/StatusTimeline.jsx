export default function StatusTimeline({ statuses, active }) {
  return (
    <section className="section" id="status">
      <div className="section__header">
        <div>
          <p className="section__eyebrow">Step 07</p>
          <h2>진행 상태 & 알림</h2>
          <p className="section__description">
            업로드된 작업은 큐에 등록되고 순차 처리됩니다. 파이프라인 이벤트가 들어오면 동일한 타임라인 구성 요소를 통해
            사용자에게 상태를 브로드캐스트합니다.
          </p>
        </div>
      </div>

      <div className="timeline">
        {statuses.map((status) => (
          <div key={status.label} className={`timeline__item ${active === status.key ? 'is-active' : ''}`}>
            <span className="timeline__dot" />
            <div>
              <p>{status.label}</p>
              <small>{status.description}</small>
            </div>
            <span className="timeline__time">{status.duration}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

