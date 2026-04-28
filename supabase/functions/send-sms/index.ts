// Supabase Edge Function: send-sms
// Solapi (구 Cool SMS) 를 통해 SMS/LMS 발송
// 추심법 야간 발송 금지 시간(21시~익일 8시 KST) 자동 차단
//
// 환경변수 (Supabase Secrets):
//   SOLAPI_API_KEY      - Solapi API Key
//   SOLAPI_API_SECRET   - Solapi API Secret
//   SOLAPI_SENDER       - 사전 등록된 발신번호 (예: 0212345678)
//   ALLOW_NIGHT_SEND    - 'true' 일 때만 야간 발송 허용 (기본 차단)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// HMAC-SHA256 서명 생성
async function makeAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID();
  const message = `${date}${salt}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 한국 시간 hour 추출 (UTC + 9)
function getKstHour(): number {
  const utc = new Date();
  return (utc.getUTCHours() + 9) % 24;
}

// 추심법 21시~8시 차단 체크
function isNightTime(): boolean {
  const h = getKstHour();
  return h >= 21 || h < 8;
}

// 010-1234-5678 → 01012345678 정규화
function normalizePhone(s: string): string {
  return (s || '').replace(/[^0-9]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405);
  }

  try {
    const { to, text, force } = await req.json();
    if (!to || !text) {
      return jsonResponse({ ok: false, error: 'to, text 필수' }, 400);
    }

    // 야간 발송 가드
    const allowNight = Deno.env.get('ALLOW_NIGHT_SEND') === 'true';
    if (isNightTime() && !allowNight && !force) {
      return jsonResponse({
        ok: false,
        error: `추심법: 야간(21시~익일 8시) 발송 금지 시간입니다.\n현재 KST ${getKstHour()}시. force=true 로 우회 가능 (권장 X).`,
      }, 400);
    }

    const apiKey = Deno.env.get('SOLAPI_API_KEY');
    const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
    const sender = Deno.env.get('SOLAPI_SENDER');
    if (!apiKey || !apiSecret || !sender) {
      return jsonResponse({
        ok: false,
        error: 'Supabase Secrets 미설정: SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER',
      }, 500);
    }

    const auth = await makeAuthHeader(apiKey, apiSecret);
    // 90바이트 초과는 LMS 자동 (한글 약 45자)
    const byteLength = new TextEncoder().encode(text).length;
    const type = byteLength > 90 ? 'LMS' : 'SMS';

    const body = {
      message: {
        to: normalizePhone(to),
        from: normalizePhone(sender),
        text,
        type,
      },
    };

    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return jsonResponse({
        ok: false,
        error: `Solapi 오류: ${data.errorCode || res.status} ${data.errorMessage || ''}`,
        raw: data,
      }, 500);
    }

    return jsonResponse({
      ok: true,
      type,
      message_id: data.messageId,
      group_id: data.groupId,
      status_code: data.statusCode,
      raw: data,
    });
  } catch (e: any) {
    return jsonResponse({ ok: false, error: e?.message || String(e) }, 500);
  }
});
