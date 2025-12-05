import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AuthPages.css';

export default function SignupPage() {
  const navigate = useNavigate();
  const { signUp, isAuthenticated } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    displayName: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 이미 로그인된 경우 리다이렉트
  if (isAuthenticated) {
    navigate('/upload');
    return null;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    // 비밀번호 확인
    if (form.password !== form.passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (form.password.length < 4) {
      setError('비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }

    setLoading(true);

    const result = await signUp(form.email, form.password, form.displayName);

    if (result.success) {
      // 회원가입 성공
      navigate('/upload');
    } else {
      setError(result.error || '회원가입에 실패했습니다.');
    }

    setLoading(false);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value
    }));
    setError('');
  };

  return (
    <section className="authPage">
      <div className="authCard">
        <div className="authCard__header">
          <h1>회원가입</h1>
          <p>새 계정을 만들고 <strong>100 크레딧</strong>을 받으세요!</p>
        </div>

        {error && (
          <div className="authCard__error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="authCard__form">
          <div className="authCard__field">
            <label htmlFor="email">이메일 *</label>
            <input
              type="email"
              id="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          <div className="authCard__field">
            <label htmlFor="displayName">닉네임</label>
            <input
              type="text"
              id="displayName"
              name="displayName"
              placeholder="표시될 이름 (선택)"
              value={form.displayName}
              onChange={handleChange}
              autoComplete="name"
            />
          </div>

          <div className="authCard__field">
            <label htmlFor="password">비밀번호 *</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="최소 4자 이상"
              value={form.password}
              onChange={handleChange}
              required
              minLength={4}
              autoComplete="new-password"
            />
          </div>

          <div className="authCard__field">
            <label htmlFor="passwordConfirm">비밀번호 확인 *</label>
            <input
              type="password"
              id="passwordConfirm"
              name="passwordConfirm"
              placeholder="비밀번호를 다시 입력하세요"
              value={form.passwordConfirm}
              onChange={handleChange}
              required
              minLength={4}
              autoComplete="new-password"
            />
          </div>

          <button 
            type="submit" 
            className="authCard__submit"
            disabled={loading}
          >
            {loading ? '가입 중...' : '회원가입'}
          </button>
        </form>

        <div className="authCard__footer">
          <p>
            이미 계정이 있으신가요?{' '}
            <Link to="/login">로그인</Link>
          </p>
        </div>

        <div className="authCard__info">
          <h3>🎁 가입 혜택</h3>
          <ul>
            <li>✓ 즉시 사용 가능한 <strong>100 크레딧</strong> 지급</li>
            <li>✓ AD 생성 1회당 9.98 크레딧 사용</li>
            <li>✓ TTS 변환은 추가 비용 없음</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

