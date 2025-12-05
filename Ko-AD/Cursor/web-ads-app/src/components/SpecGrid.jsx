export default function SpecGrid({ limits, nonFunctional, future }) {
  return (
    <section className="section" id="specs">
      <div className="specGrid">
        <article>
          <p className="section__eyebrow">업로드 한도</p>
          <h3>사용자 가이드</h3>
          <ul>
            {limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article>
          <p className="section__eyebrow">비기능 요구사항</p>
          <h3>운영 정책</h3>
          <ul>
            {nonFunctional.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article>
          <p className="section__eyebrow">로드맵</p>
          <h3>확장 계획</h3>
          <ul>
            {future.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

