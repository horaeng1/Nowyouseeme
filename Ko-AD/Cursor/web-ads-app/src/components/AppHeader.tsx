import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AppHeader.css';

/**
 * AppHeader Component
 * 
 * Common top navigation bar for both upload and editor pages.
 * 
 * Features:
 * - Left: Ko-AD brand/logo that links to home
 * - Center: Navigation tabs (제품소개, 동영상 업로드, 동영상 편집)
 * - Right: Dark/light mode toggle, credits display, and login/logout button
 */

interface AppHeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) => 
  `appHeader__link${isActive ? ' active' : ''}`;

export const AppHeader: React.FC<AppHeaderProps> = ({ theme, onToggleTheme }) => {
  const { user, credits, isAuthenticated, signOut, loading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  // 크레딧 포맷팅
  const formatCredits = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-';
    return amount.toFixed(2);
  };

  return (
    <header className="appHeader">
      <NavLink to="/" className="appHeader__logo">
        Ko-AD
      </NavLink>
      <nav className="appHeader__links">
        <NavLink to="/" end className={navLinkClass}>
          제품소개
        </NavLink>
        <NavLink to="/upload" className={navLinkClass}>
          동영상 업로드
        </NavLink>
        <NavLink to="/video-editor" className={navLinkClass}>
          동영상 편집
        </NavLink>
      </nav>
      <div className="appHeader__actions">
        <button className="appHeader__theme" onClick={onToggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        {isAuthenticated ? (
          <>
            {/* 크레딧 표시 (클릭 시 프로필로 이동) */}
            <NavLink to="/profile" className="appHeader__credits" title="내 프로필">
              <span className="appHeader__creditsIcon">🪙</span>
              <span className="appHeader__creditsAmount">
                {loading ? '...' : formatCredits(credits)}
              </span>
            </NavLink>

            {/* 사용자 메뉴 */}
            <div className="appHeader__user">
              <NavLink to="/profile" className="appHeader__userName">
                {user?.email?.split('@')[0]}
              </NavLink>
              <button 
                className="appHeader__logout" 
                onClick={handleLogout}
                title="로그아웃"
              >
                로그아웃
              </button>
            </div>
          </>
        ) : (
          <>
            <NavLink to="/login" className="appHeader__login">
              로그인
            </NavLink>
            <NavLink to="/signup" className="appHeader__cta">
              무료 가입
            </NavLink>
          </>
        )}
      </div>
    </header>
  );
};
