/**
 * Supabase 클라이언트 설정
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://wmkbqybcsrdkxsyzlmpo.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indta2JxeWJjc3Jka3hzeXpsbXBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MjI3MzAsImV4cCI6MjA4MDM5ODczMH0.mPaP1m2Hka7SUtif8AETXLE09RR3dzIBNVJQExEjLck';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;

