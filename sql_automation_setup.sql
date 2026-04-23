-- ====================================================================
-- 자동 조치 (SMS / 신정사 메일) 시스템 설정
-- Phase 1: UI/UX + 발송 큐 + 이력. 실제 발송 API 연동은 stub.
-- ====================================================================

-- [1] 자동 조치 설정 (전역, 단일 행)
CREATE TABLE IF NOT EXISTS automation_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  sms_auto_enabled BOOLEAN DEFAULT false,
  sms_template TEXT DEFAULT '안녕하세요, {name}님. 현재 {days}일 연체 중이며 미수액 {amount}원입니다. 빠른 납부 부탁드립니다.',
  sms_max_count INT DEFAULT 3,
  sms_cooldown_days INT DEFAULT 7,
  credit_agencies JSONB DEFAULT '[{"name":"","email":""},{"name":"","email":""}]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO automation_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- [2] 자동 조치 발송 이력
CREATE TABLE IF NOT EXISTS automation_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,           -- 'sms_lessee' | 'sms_distributor' | 'credit_agency_email'
  target_address TEXT,
  target_name TEXT,
  agency_name TEXT,                    -- 신정사 이름 (credit_agency_email 일 때)
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'queued',        -- 'queued' | 'sent' | 'failed' | 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error TEXT,
  is_mock BOOLEAN DEFAULT true         -- 실제 API 연동 전이라 mock 표시
);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_contract ON automation_dispatch_log(contract_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_status ON automation_dispatch_log(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_created ON automation_dispatch_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_action ON automation_dispatch_log(action_type);

-- [3] SMS 대상 조회: 8일+ 연체 & 발송횟수<3 & 쿨다운 통과
DROP FUNCTION IF EXISTS get_pending_sms_targets(DATE);
CREATE OR REPLACE FUNCTION get_pending_sms_targets(
  anchor_date DATE DEFAULT (CURRENT_DATE - 1)
)
RETURNS TABLE (
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  lessee_contact TEXT,
  distributor_name TEXT,
  distributor_contact TEXT,
  overdue_days INT,
  total_unpaid NUMERIC,
  past_send_count INT,
  last_sent_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  WITH unpaid_calc AS (
    SELECT dd.contract_id, MIN(dd.due_date) AS oldest_unpaid,
           SUM(dd.amount - dd.paid_amount) AS unpaid
    FROM daily_deductions dd
    JOIN contracts c ON c.id = dd.contract_id
    WHERE dd.status <> '납부완료' AND dd.amount > dd.paid_amount
      AND dd.due_date <= anchor_date
      AND dd.due_date >= c.execution_date
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)
    GROUP BY dd.contract_id
    HAVING (anchor_date - MIN(dd.due_date)) >= 8
  ),
  send_history AS (
    SELECT
      contract_id,
      -- 한 회차 = 계약자+총판 2건이므로 /2
      (COUNT(*) FILTER (WHERE status IN ('sent','queued')
                          AND action_type IN ('sms_lessee','sms_distributor')) / 2)::INT AS send_count,
      MAX(sent_at) FILTER (WHERE status = 'sent'
                             AND action_type IN ('sms_lessee','sms_distributor')) AS last_sent
    FROM automation_dispatch_log
    GROUP BY contract_id
  ),
  settings AS (
    SELECT sms_max_count, sms_cooldown_days FROM automation_settings WHERE id = 'global'
  )
  SELECT
    c.id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    c.lessee_contact::TEXT,
    COALESCE(c.distributor_name, '')::TEXT,
    c.distributor_contact::TEXT,
    (anchor_date - uc.oldest_unpaid)::INT,
    uc.unpaid::NUMERIC,
    COALESCE(sh.send_count, 0),
    sh.last_sent
  FROM contracts c
  JOIN unpaid_calc uc ON uc.contract_id = c.id
  LEFT JOIN send_history sh ON sh.contract_id = c.id
  CROSS JOIN settings s
  WHERE c.execution_date >= DATE '2025-10-01'
    AND COALESCE(sh.send_count, 0) < s.sms_max_count
    AND (sh.last_sent IS NULL OR sh.last_sent < NOW() - (s.sms_cooldown_days || ' days')::INTERVAL)
  ORDER BY (anchor_date - uc.oldest_unpaid) DESC, uc.unpaid DESC;
$$;
GRANT EXECUTE ON FUNCTION get_pending_sms_targets(DATE) TO anon, authenticated;

-- [4] 신정사 메일 대상 조회: 21일+ 연체
DROP FUNCTION IF EXISTS get_pending_credit_agency_targets(DATE);
CREATE OR REPLACE FUNCTION get_pending_credit_agency_targets(
  anchor_date DATE DEFAULT (CURRENT_DATE - 1)
)
RETURNS TABLE (
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  lessee_contact TEXT,
  lessee_business_number TEXT,
  distributor_name TEXT,
  overdue_days INT,
  total_unpaid NUMERIC,
  already_sent BOOLEAN,
  last_sent_agency TEXT,
  last_sent_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  WITH unpaid_calc AS (
    SELECT dd.contract_id, MIN(dd.due_date) AS oldest_unpaid,
           SUM(dd.amount - dd.paid_amount) AS unpaid
    FROM daily_deductions dd
    JOIN contracts c ON c.id = dd.contract_id
    WHERE dd.status <> '납부완료' AND dd.amount > dd.paid_amount
      AND dd.due_date <= anchor_date
      AND dd.due_date >= c.execution_date
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)
    GROUP BY dd.contract_id
    HAVING (anchor_date - MIN(dd.due_date)) >= 21
  ),
  agency_history AS (
    SELECT
      contract_id,
      MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent,
      (ARRAY_AGG(agency_name ORDER BY sent_at DESC NULLS LAST)
        FILTER (WHERE status = 'sent'))[1] AS last_agency
    FROM automation_dispatch_log
    WHERE action_type = 'credit_agency_email'
    GROUP BY contract_id
  )
  SELECT
    c.id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    c.lessee_contact::TEXT,
    c.lessee_business_number::TEXT,
    COALESCE(c.distributor_name, '')::TEXT,
    (anchor_date - uc.oldest_unpaid)::INT,
    uc.unpaid::NUMERIC,
    (ah.last_sent IS NOT NULL),
    ah.last_agency::TEXT,
    ah.last_sent
  FROM contracts c
  JOIN unpaid_calc uc ON uc.contract_id = c.id
  LEFT JOIN agency_history ah ON ah.contract_id = c.id
  WHERE c.execution_date >= DATE '2025-10-01'
  ORDER BY (anchor_date - uc.oldest_unpaid) DESC, uc.unpaid DESC;
$$;
GRANT EXECUTE ON FUNCTION get_pending_credit_agency_targets(DATE) TO anon, authenticated;
