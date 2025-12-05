import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import './ProfilePage.css';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, credits, isAuthenticated, refreshCredits, signOut, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  // 비로그인 시 리다이렉트
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // 프로필 및 거래내역 로드
  useEffect(() => {
    const loadData = async () => {
      if (!user?.id) {
        if (!authLoading) {
          setDataLoading(false);
        }
        return;
      }

      try {
        // 프로필 정보
        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profileData) {
          setProfile(profileData);
        }

        // 거래 내역
        const { data: txData } = await supabase
          .from('credit_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (txData) {
          setTransactions(txData);
        }
      } catch (err) {
        console.error('Failed to load profile data:', err);
      } finally {
        setDataLoading(false);
      }
    };

    loadData();
  }, [user?.id, authLoading]);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  // 거래 유형 한글화
  const getTransactionTypeLabel = (type) => {
    const labels = {
      'signup_bonus': '🎁 가입 보너스',
      'ad_generation': '🎬 AD 생성',
      'purchase': '💳 크레딧 구매',
      'refund': '↩️ 환불',
      'admin_adjust': '⚙️ 관리자 조정'
    };
    return labels[type] || type;
  };

  // 날짜 포맷
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (authLoading || dataLoading) {
    return (
      <section className="profilePage">
        <div className="profilePage__loading">로딩 중...</div>
      </section>
    );
  }

  if (!user) {
    return null; // 리다이렉트 중
  }

  return (
    <section className="profilePage">
      <div className="profilePage__container">
        {/* 프로필 카드 */}
        <div className="profileCard">
          <div className="profileCard__header">
            <div className="profileCard__avatar">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="profileCard__info">
              <h1>{profile?.display_name || user?.email?.split('@')[0]}</h1>
              <p>{user?.email}</p>
            </div>
          </div>

          <div className="profileCard__stats">
            <div className="profileCard__stat">
              <span className="profileCard__statLabel">보유 크레딧</span>
              <span className="profileCard__statValue profileCard__statValue--credits">
                🪙 {parseFloat(profile?.credits || credits || 0).toFixed(2)}
              </span>
            </div>
            <div className="profileCard__stat">
              <span className="profileCard__statLabel">총 사용량</span>
              <span className="profileCard__statValue">
                {parseFloat(profile?.total_used || 0).toFixed(2)}
              </span>
            </div>
            <div className="profileCard__stat">
              <span className="profileCard__statLabel">가입일</span>
              <span className="profileCard__statValue">
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR') : '-'}
              </span>
            </div>
          </div>

          <div className="profileCard__actions">
            <button className="profileCard__btn profileCard__btn--primary" disabled>
              💳 크레딧 충전 (준비 중)
            </button>
            <button className="profileCard__btn profileCard__btn--secondary" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </div>

        {/* 크레딧 사용 내역 */}
        <div className="transactionCard">
          <h2>크레딧 사용 내역</h2>
          
          {transactions.length === 0 ? (
            <div className="transactionCard__empty">
              아직 거래 내역이 없습니다.
            </div>
          ) : (
            <div className="transactionCard__list">
              {transactions.map((tx) => (
                <div key={tx.id} className="transactionCard__item">
                  <div className="transactionCard__itemLeft">
                    <span className="transactionCard__type">
                      {getTransactionTypeLabel(tx.type)}
                    </span>
                    <span className="transactionCard__desc">
                      {tx.description || '-'}
                    </span>
                    <span className="transactionCard__date">
                      {formatDate(tx.created_at)}
                    </span>
                  </div>
                  <div className="transactionCard__itemRight">
                    <span className={`transactionCard__amount ${parseFloat(tx.amount) >= 0 ? 'positive' : 'negative'}`}>
                      {parseFloat(tx.amount) >= 0 ? '+' : ''}{parseFloat(tx.amount).toFixed(2)}
                    </span>
                    <span className="transactionCard__balance">
                      잔액: {parseFloat(tx.balance_after).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 요금 안내 */}
        <div className="pricingCard">
          <h2>요금 안내</h2>
          <div className="pricingCard__items">
            <div className="pricingCard__item">
              <span className="pricingCard__service">🎬 AD 생성</span>
              <span className="pricingCard__price">9.98 크레딧 / 회</span>
            </div>
            <div className="pricingCard__item">
              <span className="pricingCard__service">🔊 TTS 변환</span>
              <span className="pricingCard__price">무료</span>
            </div>
            <div className="pricingCard__item">
              <span className="pricingCard__service">📥 동영상 내보내기</span>
              <span className="pricingCard__price">무료</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

