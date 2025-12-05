import { useState } from 'react';

export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="section" id="faq">
      <div className="section__header">
        <div>
          <p className="section__eyebrow">FAQ</p>
          <h2>자주 묻는 질문</h2>
        </div>
      </div>
      <div className="faq">
        {items.map((faq, index) => {
          const isOpen = index === openIndex;
          return (
            <article key={faq.question} className={`faq__item ${isOpen ? 'is-open' : ''}`}>
              <button onClick={() => setOpenIndex(isOpen ? -1 : index)}>
                <span>{faq.question}</span>
                <span>{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && <p>{faq.answer}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

