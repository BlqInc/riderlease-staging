-- ====================================================================
-- 정산요청서 (settlement_requests) 시스템
-- Phase 2a: 청구서 발행 → SMS 발송 → 토큰 페이지 조회/회신 → 대사 → 입금반영
-- ====================================================================

-- [1] 정산요청서 본문
CREATE TABLE IF NOT EXISTS settlement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT UNIQUE NOT NULL,        -- 사람이 읽는 번호 (BLQ-YYYYMMDD-NNNN)
  distributor_partner_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  distributor_name TEXT NOT NULL,             -- 스냅샷 (총판명 변경 대비)
  distributor_contact TEXT,                   -- 발송 대상 SMS 수신처 스냅샷
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  billing_amount NUMERIC NOT NULL DEFAULT 0,  -- 청구 총액 (원래)
  adjusted_amount NUMERIC,                    -- 총판 회신 후 조정액
  paid_amount NUMERIC,                        -- 실제 입금 확인액
  status TEXT NOT NULL DEFAULT 'draft',       -- draft|sent|replied|reconciled|completed|cancelled
  token TEXT UNIQUE NOT NULL,                 -- 총판 외부 URL 토큰
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  reply_memo TEXT,                            -- 총판이 회신 시 남긴 메모
  admin_memo TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_requests_status ON settlement_requests(status);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_distributor ON settlement_requests(distributor_partner_id);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_token ON settlement_requests(token);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_period ON settlement_requests(period_from, period_to);
CREATE INDEX IF NOT EXISTS idx_settlement_requests_created ON settlement_requests(created_at DESC);

-- [2] 청구서 항목 (계약 단위)
CREATE TABLE IF NOT EXISTS settlement_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES settlement_requests(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  contract_number INT,                        -- 스냅샷
  lessee_name TEXT,                           -- 스냅샷
  device_name TEXT,                           -- 스냅샷
  period_amount NUMERIC NOT NULL DEFAULT 0,   -- 해당 기간 내 미납 합계 (청구액)
  excluded BOOLEAN NOT NULL DEFAULT FALSE,    -- 총판 회신 시 제외 요청
  excluded_reason TEXT,
  adjusted_amount NUMERIC,                    -- 회신 조정 후 금액 (제외면 0, 부분조정도 가능)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_request_items_request ON settlement_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_settlement_request_items_contract ON settlement_request_items(contract_id);

-- [3] 발송 이력 (SMS 등 채널별 기록)
CREATE TABLE IF NOT EXISTS settlement_request_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES settlement_requests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                      -- 'sms' | 'manual' (수동 복사)
  target_contact TEXT,                        -- SMS 수신번호 (manual은 NULL)
  body TEXT,                                  -- 발송 본문 스냅샷
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent',        -- 'sent' | 'failed'
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_settlement_request_dispatches_request ON settlement_request_dispatches(request_id);
CREATE INDEX IF NOT EXISTS idx_settlement_request_dispatches_sent ON settlement_request_dispatches(sent_at DESC);

-- [4] 입금/대사 결과 기록 (한 청구서당 최종 1건이지만 재처리 대비 이력 보존)
CREATE TABLE IF NOT EXISTS settlement_request_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES settlement_requests(id) ON DELETE CASCADE,
  paid_amount NUMERIC NOT NULL,               -- 어드민이 입력한 실 입금액
  paid_date DATE,                             -- 입금일자
  bank_memo TEXT,                             -- 통장 메모/입금자명
  applied_at TIMESTAMPTZ DEFAULT NOW(),       -- daily_deductions 반영 시각
  applied_by TEXT,
  -- 분배 내역 백업 (롤백/감사용): [{contract_id, deduction_id, applied_amount, before_paid}]
  distribution JSONB
);

CREATE INDEX IF NOT EXISTS idx_settlement_request_payments_request ON settlement_request_payments(request_id);

-- [5] 자동 updated_at 갱신
CREATE OR REPLACE FUNCTION touch_settlement_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settlement_requests_updated_at ON settlement_requests;
CREATE TRIGGER trg_settlement_requests_updated_at
  BEFORE UPDATE ON settlement_requests
  FOR EACH ROW EXECUTE FUNCTION touch_settlement_requests_updated_at();

-- [6] 청구번호 자동 생성 헬퍼 (BLQ-YYYYMMDD-NNNN)
CREATE OR REPLACE FUNCTION generate_settlement_request_number(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  date_part TEXT;
  next_seq INT;
  candidate TEXT;
BEGIN
  date_part := TO_CHAR(p_date, 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SUBSTRING(request_number FROM 14) AS INT)), 0) + 1
    INTO next_seq
    FROM settlement_requests
    WHERE request_number LIKE 'BLQ-' || date_part || '-%';
  candidate := 'BLQ-' || date_part || '-' || LPAD(next_seq::TEXT, 4, '0');
  RETURN candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_settlement_request_number(DATE) TO anon, authenticated;

-- [7] 토큰 → 청구서 조회 RPC (총판 외부 페이지에서 anon 권한으로 호출)
DROP FUNCTION IF EXISTS get_settlement_request_by_token(TEXT);
CREATE OR REPLACE FUNCTION get_settlement_request_by_token(p_token TEXT)
RETURNS TABLE (
  id UUID,
  request_number TEXT,
  distributor_name TEXT,
  period_from DATE,
  period_to DATE,
  billing_amount NUMERIC,
  adjusted_amount NUMERIC,
  status TEXT,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reply_memo TEXT,
  items JSONB
)
LANGUAGE sql STABLE AS $$
  SELECT
    sr.id,
    sr.request_number,
    sr.distributor_name,
    sr.period_from,
    sr.period_to,
    sr.billing_amount,
    sr.adjusted_amount,
    sr.status,
    sr.sent_at,
    sr.replied_at,
    sr.reply_memo,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'contract_id', i.contract_id,
        'contract_number', i.contract_number,
        'lessee_name', i.lessee_name,
        'device_name', i.device_name,
        'period_amount', i.period_amount,
        'excluded', i.excluded,
        'excluded_reason', i.excluded_reason,
        'adjusted_amount', i.adjusted_amount
      ) ORDER BY i.contract_number)
       FROM settlement_request_items i WHERE i.request_id = sr.id),
      '[]'::jsonb
    )
  FROM settlement_requests sr
  WHERE sr.token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_settlement_request_by_token(TEXT) TO anon, authenticated;

-- [8] 토큰 기반 회신 처리 RPC (총판이 외부 페이지에서 호출)
-- p_excluded_items: [{item_id, excluded, excluded_reason, adjusted_amount}]
DROP FUNCTION IF EXISTS submit_settlement_request_reply(TEXT, JSONB, TEXT);
CREATE OR REPLACE FUNCTION submit_settlement_request_reply(
  p_token TEXT,
  p_items JSONB,
  p_memo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_request_id UUID;
  v_status TEXT;
  v_item JSONB;
  v_adjusted NUMERIC := 0;
BEGIN
  SELECT id, status INTO v_request_id, v_status
    FROM settlement_requests WHERE token = p_token FOR UPDATE;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '청구서를 찾을 수 없습니다');
  END IF;
  IF v_status NOT IN ('sent', 'replied') THEN
    RETURN jsonb_build_object('ok', false, 'error', '회신할 수 없는 상태입니다: ' || v_status);
  END IF;

  -- 항목별 업데이트
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE settlement_request_items
       SET excluded = COALESCE((v_item->>'excluded')::BOOLEAN, FALSE),
           excluded_reason = v_item->>'excluded_reason',
           adjusted_amount = CASE
             WHEN COALESCE((v_item->>'excluded')::BOOLEAN, FALSE) THEN 0
             ELSE COALESCE((v_item->>'adjusted_amount')::NUMERIC, period_amount)
           END
     WHERE id = (v_item->>'item_id')::UUID
       AND request_id = v_request_id;
  END LOOP;

  -- 조정 합계 계산
  SELECT COALESCE(SUM(COALESCE(adjusted_amount, period_amount)), 0)
    INTO v_adjusted
    FROM settlement_request_items
   WHERE request_id = v_request_id AND excluded = FALSE;

  UPDATE settlement_requests
     SET status = 'replied',
         adjusted_amount = v_adjusted,
         replied_at = NOW(),
         reply_memo = p_memo
   WHERE id = v_request_id;

  RETURN jsonb_build_object('ok', true, 'adjusted_amount', v_adjusted);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_settlement_request_reply(TEXT, JSONB, TEXT) TO anon, authenticated;
