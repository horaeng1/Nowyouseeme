/**
 * 인증 Context
 * 로그인 상태, 사용자 정보, 크레딧 관리
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

// API Base URL (Vite 프록시를 통해 /api 요청이 백엔드로 전달됨)
const API_BASE = '';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(true);

  // 사용자 프로필 및 크레딧 가져오기 (백엔드 API 사용)
  const fetchUserProfile = useCallback(async (accessToken) => {
    console.log('[Auth] fetchUserProfile called');
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      console.log('[Auth] API response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Auth] Profile data:', data);
        if (data.user) {
          setCredits(data.user.credits || 0);
          return data.user;
        }
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
    }
    return null;
  }, []);

  // 크레딧만 새로고침
  const refreshCredits = useCallback(async () => {
    if (!session?.access_token) return null;
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/credits`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCredits(data.credits || 0);
        return data.credits;
      }
    } catch (err) {
      console.error('[Auth] Failed to refresh credits:', err);
    }
    return null;
  }, [session]);

  // 세션 변경 감지
  useEffect(() => {
    // 현재 세션 가져오기
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.access_token) {
        fetchUserProfile(session.access_token);
      }
      
      setLoading(false);
    });

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] State change:', event);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.access_token) {
          await fetchUserProfile(session.access_token);
        } else {
          setCredits(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchUserProfile]);

  // 회원가입
  const signUp = async (email, password, displayName) => {
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });

      if (error) throw error;

      // 프로필 업데이트 (display_name)
      if (data.user && displayName) {
        await supabase
          .from('user_profiles')
          .update({ display_name: displayName })
          .eq('id', data.user.id);
      }

      return { success: true, user: data.user, session: data.session };
    } catch (err) {
      console.error('[Auth] Signup error:', err);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // 로그인
  const signIn = async (email, password) => {
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      return { success: true, user: data.user, session: data.session };
    } catch (err) {
      console.error('[Auth] Login error:', err);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // 로그아웃
  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setCredits(null);
      return { success: true };
    } catch (err) {
      console.error('[Auth] Logout error:', err);
      return { success: false, error: err.message };
    }
  };

  // 인증 헤더 가져오기 (API 호출용)
  const getAuthHeaders = useCallback(() => {
    if (!session?.access_token) return {};
    return {
      'Authorization': `Bearer ${session.access_token}`
    };
  }, [session]);

  const value = {
    user,
    session,
    credits,
    loading,
    isAuthenticated: !!user,
    signUp,
    signIn,
    signOut,
    refreshCredits,
    getAuthHeaders
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;

