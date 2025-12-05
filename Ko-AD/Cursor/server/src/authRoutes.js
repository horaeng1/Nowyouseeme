/**
 * 인증 관련 API 라우트
 * Supabase Auth를 사용한 회원가입, 로그인, 로그아웃
 */

const express = require('express');
const { supabase, supabaseAdmin } = require('./supabaseClient');

const router = express.Router();

// 크레딧 상수
const CREDIT_COST_AD_GENERATION = 9.98;

/**
 * POST /api/auth/signup
 * 회원가입
 */
router.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body;

  console.log('[Auth] POST /signup', { email, displayName });

  if (!email || !password) {
    return res.status(400).json({
      status: 'error',
      message: '이메일과 비밀번호는 필수입니다.'
    });
  }

  if (password.length < 4) {
    return res.status(400).json({
      status: 'error',
      message: '비밀번호는 최소 4자 이상이어야 합니다.'
    });
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || email.split('@')[0]
        }
      }
    });

    if (error) {
      console.error('[Auth] Signup error:', error);
      return res.status(400).json({
        status: 'error',
        message: error.message
      });
    }

    console.log('[Auth] Signup success:', data.user?.id);

    // display_name 업데이트 (트리거가 먼저 실행되므로)
    if (displayName && data.user) {
      const adminClient = supabaseAdmin || supabase;
      await adminClient
        .from('user_profiles')
        .update({ display_name: displayName })
        .eq('id', data.user.id);
    }

    res.json({
      status: 'ok',
      message: '회원가입이 완료되었습니다.',
      user: {
        id: data.user?.id,
        email: data.user?.email
      },
      session: data.session
    });
  } catch (err) {
    console.error('[Auth] Signup exception:', err);
    res.status(500).json({
      status: 'error',
      message: '회원가입 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/login
 * 로그인
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  console.log('[Auth] POST /login', { email });

  if (!email || !password) {
    return res.status(400).json({
      status: 'error',
      message: '이메일과 비밀번호는 필수입니다.'
    });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('[Auth] Login error:', error);
      return res.status(401).json({
        status: 'error',
        message: '이메일 또는 비밀번호가 올바르지 않습니다.'
      });
    }

    console.log('[Auth] Login success:', data.user?.id);

    res.json({
      status: 'ok',
      message: '로그인되었습니다.',
      user: {
        id: data.user?.id,
        email: data.user?.email
      },
      session: data.session
    });
  } catch (err) {
    console.error('[Auth] Login exception:', err);
    res.status(500).json({
      status: 'error',
      message: '로그인 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/auth/logout
 * 로그아웃
 */
router.post('/logout', async (req, res) => {
  console.log('[Auth] POST /logout');

  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[Auth] Logout error:', error);
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }

    res.json({
      status: 'ok',
      message: '로그아웃되었습니다.'
    });
  } catch (err) {
    console.error('[Auth] Logout exception:', err);
    res.status(500).json({
      status: 'error',
      message: '로그아웃 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/auth/me
 * 현재 사용자 정보 조회 (프로필 + 크레딧)
 */
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: '인증이 필요합니다.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 토큰으로 사용자 정보 가져오기
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: '유효하지 않은 토큰입니다.'
      });
    }

    // 프로필 정보 가져오기 (supabaseAdmin 사용 - RLS 우회)
    const client = supabaseAdmin || supabase;
    const { data: profile, error: profileError } = await client
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('[Auth] Profile fetch error:', profileError);
      return res.status(500).json({
        status: 'error',
        message: '프로필 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      status: 'ok',
      user: {
        id: user.id,
        email: user.email,
        displayName: profile?.display_name,
        credits: parseFloat(profile?.credits || 0),
        totalUsed: parseFloat(profile?.total_used || 0),
        createdAt: profile?.created_at
      }
    });
  } catch (err) {
    console.error('[Auth] Me exception:', err);
    res.status(500).json({
      status: 'error',
      message: '사용자 정보 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/auth/credits
 * 크레딧 정보 조회
 */
router.get('/credits', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: '인증이 필요합니다.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: '유효하지 않은 토큰입니다.'
      });
    }

    const client = supabaseAdmin || supabase;
    const { data: profile, error } = await client
      .from('user_profiles')
      .select('credits, total_used')
      .eq('id', user.id)
      .single();

    if (error) {
      return res.status(500).json({
        status: 'error',
        message: '크레딧 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      status: 'ok',
      credits: parseFloat(profile?.credits || 0),
      totalUsed: parseFloat(profile?.total_used || 0),
      costPerGeneration: CREDIT_COST_AD_GENERATION
    });
  } catch (err) {
    console.error('[Auth] Credits exception:', err);
    res.status(500).json({
      status: 'error',
      message: '크레딧 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/auth/transactions
 * 크레딧 거래 내역 조회
 */
router.get('/transactions', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: '인증이 필요합니다.'
    });
  }

  const token = authHeader.split(' ')[1];
  const limit = parseInt(req.query.limit) || 20;

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: '유효하지 않은 토큰입니다.'
      });
    }

    const { data: transactions, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({
        status: 'error',
        message: '거래 내역 조회 중 오류가 발생했습니다.'
      });
    }

    res.json({
      status: 'ok',
      transactions: transactions.map(t => ({
        id: t.id,
        amount: parseFloat(t.amount),
        type: t.type,
        description: t.description,
        jobId: t.job_id,
        balanceAfter: parseFloat(t.balance_after),
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    console.error('[Auth] Transactions exception:', err);
    res.status(500).json({
      status: 'error',
      message: '거래 내역 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * 크레딧 차감 함수 (내부 사용)
 * @param {string} userId - 사용자 ID
 * @param {number} amount - 차감할 크레딧 (양수)
 * @param {string} type - 거래 유형
 * @param {string} description - 설명
 * @param {string} jobId - 관련 작업 ID
 * @returns {Promise<{success: boolean, credits?: number, error?: string}>}
 */
async function deductCredits(userId, amount, type, description, jobId = null) {
  const client = supabaseAdmin || supabase;

  try {
    // 현재 크레딧 조회 (total_used 포함!)
    const { data: profile, error: fetchError } = await client
      .from('user_profiles')
      .select('credits, total_used')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      console.error('[Credits] Fetch error:', fetchError);
      return { success: false, error: '사용자를 찾을 수 없습니다.' };
    }

    const currentCredits = parseFloat(profile.credits || 0);
    const currentTotalUsed = parseFloat(profile.total_used || 0);

    if (currentCredits < amount) {
      return { 
        success: false, 
        error: `크레딧이 부족합니다. (현재: ${currentCredits.toFixed(2)}, 필요: ${amount.toFixed(2)})`,
        credits: currentCredits
      };
    }

    const newCredits = currentCredits - amount;
    const newTotalUsed = currentTotalUsed + amount;

    // 크레딧 차감
    const { error: updateError } = await client
      .from('user_profiles')
      .update({ 
        credits: newCredits,
        total_used: newTotalUsed,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[Credits] Update error:', updateError);
      return { success: false, error: '크레딧 업데이트 실패' };
    }

    // 거래 내역 기록
    await client
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: -amount,
        type,
        description,
        job_id: jobId,
        balance_after: newCredits
      });

    return { success: true, credits: newCredits };
  } catch (err) {
    console.error('[Credits] Deduct error:', err);
    return { success: false, error: '크레딧 처리 중 오류가 발생했습니다.' };
  }
}

/**
 * 크레딧 충전 함수 (내부 사용)
 */
async function addCredits(userId, amount, type, description) {
  const client = supabaseAdmin || supabase;

  try {
    const { data: profile, error: fetchError } = await client
      .from('user_profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      return { success: false, error: '사용자를 찾을 수 없습니다.' };
    }

    const newCredits = parseFloat(profile.credits) + amount;

    const { error: updateError } = await client
      .from('user_profiles')
      .update({ 
        credits: newCredits,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      return { success: false, error: '크레딧 업데이트 실패' };
    }

    await client
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: amount,
        type,
        description,
        balance_after: newCredits
      });

    return { success: true, credits: newCredits };
  } catch (err) {
    console.error('[Credits] Add error:', err);
    return { success: false, error: '크레딧 처리 중 오류가 발생했습니다.' };
  }
}

// 상수 및 함수 export
router.CREDIT_COST_AD_GENERATION = CREDIT_COST_AD_GENERATION;
router.deductCredits = deductCredits;
router.addCredits = addCredits;

module.exports = router;

