/**
 * Supabase 클라이언트 설정
 * 서버 측에서 Supabase와 통신하기 위한 클라이언트
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wmkbqybcsrdkxsyzlmpo.supabase.co';
// 여러 환경 변수 이름 지원 (SUPABASE_ANON_KEY, SUPABASE_API_KEY)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indta2JxeWJjc3Jka3hzeXpsbXBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MjI3MzAsImV4cCI6MjA4MDM5ODczMH0.mPaP1m2Hka7SUtif8AETXLE09RR3dzIBNVJQExEjLck';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// 환경변수 로드 상태 로깅
console.log('[Supabase] URL:', SUPABASE_URL);
console.log('[Supabase] ANON_KEY:', SUPABASE_ANON_KEY ? '설정됨 (길이: ' + SUPABASE_ANON_KEY.length + ')' : '미설정');
console.log('[Supabase] SERVICE_KEY:', SUPABASE_SERVICE_KEY ? '설정됨 (길이: ' + SUPABASE_SERVICE_KEY.length + ')' : '미설정 ⚠️');

// 일반 클라이언트 (RLS 적용됨)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 서비스 클라이언트 (RLS 우회, 서버 전용)
// 크레딧 차감 등 서버 측 작업에 사용
const supabaseAdmin = SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

if (supabaseAdmin) {
  console.log('[Supabase] supabaseAdmin 클라이언트 생성됨 ✓');
} else {
  console.warn('[Supabase] ⚠️ supabaseAdmin 없음 - RLS 우회 불가능. SUPABASE_SERVICE_KEY를 .env에 설정하세요.');
}

module.exports = { supabase, supabaseAdmin, SUPABASE_URL };

