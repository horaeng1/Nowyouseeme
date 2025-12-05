import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AuthPages.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, isAuthenticated } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: ''
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
    setLoading(true);

    const result = await signIn(form.email, form.password);

    if (result.success) {
      navigate('/upload');
    } else {
      setError(result.error || '로그인에 실패했습니다.');
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
          <h1>로그인</h1>
          <p>계정에 로그인하여 서비스를 이용하세요</p>
        </div>

        {error && (
          <div className="authCard__error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="authCard__form">
          <div className="authCard__field">
            <label htmlFor="email">이메일</label>
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
            <label htmlFor="password">비밀번호</label>
            <input
              type="password"
              id="password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
              minLength={4}
              autoComplete="current-password"
            />
          </div>

          <button 
            type="submit" 
            className="authCard__submit"
            disabled={loading}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="authCard__footer">
          <p>
            계정이 없으신가요?{' '}
            <Link to="/signup">회원가입</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
