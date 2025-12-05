import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AppHeader } from './components/AppHeader';
import ProductPage from './pages/ProductPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import VideoEditorPage from './pages/VideoEditorPage.tsx';
import LoginPage from './pages/LoginPage.jsx';
import SignupPage from './pages/SignupPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

import './App.css';
import './components/Hero.css';

function AppContent({ theme, onToggleTheme }) {
  return (
    <div className="appShell">
      <AppHeader theme={theme} onToggleTheme={onToggleTheme} />
      <Routes>
        <Route path="/" element={<ProductPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/video-editor" element={<VideoEditorPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ko-ad-theme') ?? 'light');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    root.classList.add(`theme-${theme}`);
    localStorage.setItem('ko-ad-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent theme={theme} onToggleTheme={toggleTheme} />
      </AuthProvider>
    </BrowserRouter>
  );
}

