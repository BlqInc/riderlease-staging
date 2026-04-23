-- ====================================================================
-- 기준일(anchor_date) 시스템 도입
-- 기본값: CURRENT_DATE - 1 (어제). 대시보드에서 '오늘'로 토글 가능.
-- 영향받는 함수:
--   get_contract_health_summary (+ monthly_forecast 필드 추가)
--   get_unpaid_contracts_all
--   get_attention_distributors
-- ====================================================================

-- [1] 건전성 요약 + 이번 달 회수 예정액
DROP FUNCTION IF EXISTS get_contract_health_summary();
DROP FUNCTION IF EXISTS get_contract_health_summary(DATE);
DROP FUNCTION IF EXISTS get_contract_health_summary(DATE, DATE, DATE);
CREATE OR REPLACE FUNCTION get_contract_health_summary(
  anchor_date DATE DEFAULT (CURRENT_DATE - 1),
  exec_from DATE DEFAULT NULL,
  exec_to DATE DEFAULT NULL
)
RETURNS TABLE (
  total_contracts INT,
  healthy_active INT,
  overdue_active INT,
  expired_healthy INT,
  expired_unpaid INT,
  total_expected NUMERIC,
  total_paid NUMERIC,
  total_unpaid NUMERIC,
  monthly_forecast NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH valid_deductions AS (
    SELECT dd.contract_id, dd.due_date, dd.amount, dd.paid_amount, dd.status
    FROM daily_deductions dd
    JOIN contracts c ON c.id = dd.contract_id
    WHERE c.execution_date >= DATE '2025-10-01'
      AND (exec_from IS NULL OR c.execution_date >= exec_from)
      AND (exec_to IS NULL OR c.execution_date <= exec_to)
      AND dd.due_date <= anchor_date
      AND dd.due_date >= c.execution_date
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)
  ),
  per_contract AS (
    SELECT
      c.id,
      c.status AS contract_status,
      COALESCE(c.daily_deduction, 0) AS daily_deduction,
      (c.expiry_date IS NOT NULL AND c.expiry_date < anchor_date) AS is_expired,
      COALESCE(SUM(vd.amount), 0) AS expected,
      COALESCE(SUM(vd.paid_amount), 0) AS paid,
      COALESCE(SUM(
        CASE WHEN vd.status <> '납부완료' AND vd.amount > vd.paid_amount
             THEN vd.amount - vd.paid_amount ELSE 0 END
      ), 0) AS unpaid,
      MIN(vd.due_date) FILTER (
        WHERE vd.status <> '납부완료' AND vd.amount > vd.paid_amount
      ) AS oldest_unpaid
    FROM contracts c
    LEFT JOIN valid_deductions vd ON vd.contract_id = c.id
    WHERE c.execution_date >= DATE '2025-10-01'
      AND (exec_from IS NULL OR c.execution_date >= exec_from)
      AND (exec_to IS NULL OR c.execution_date <= exec_to)
    GROUP BY c.id, c.status, c.daily_deduction, c.expiry_date
  ),
  month_remaining AS (
    SELECT
      ((DATE_TRUNC('month', anchor_date) + INTERVAL '1 month - 1 day')::DATE - anchor_date)::INT AS days_left
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (
      WHERE NOT is_expired
        AND (unpaid = 0 OR oldest_unpaid IS NULL OR (anchor_date - oldest_unpaid) < 8)
    )::INT,
    COUNT(*) FILTER (
      WHERE NOT is_expired AND unpaid > 0 AND oldest_unpaid IS NOT NULL
        AND (anchor_date - oldest_unpaid) >= 8
    )::INT,
    COUNT(*) FILTER (WHERE unpaid = 0 AND is_expired)::INT,
    COUNT(*) FILTER (WHERE unpaid > 0 AND is_expired)::INT,
    SUM(expected)::NUMERIC,
    SUM(paid)::NUMERIC,
    SUM(unpaid)::NUMERIC,
    (SUM(CASE WHEN contract_status <> '만료' THEN daily_deduction ELSE 0 END)
     * (SELECT days_left FROM month_remaining))::NUMERIC
  FROM per_contract;
$$;
GRANT EXECUTE ON FUNCTION get_contract_health_summary(DATE, DATE, DATE) TO anon, authenticated;

-- [2] 미수 계약 조회 (anchor_date 기반)
DROP FUNCTION IF EXISTS get_unpaid_contracts_all();
DROP FUNCTION IF EXISTS get_unpaid_contracts_all(DATE);
CREATE OR REPLACE FUNCTION get_unpaid_contracts_all(
  anchor_date DATE DEFAULT (CURRENT_DATE - 1)
)
RETURNS TABLE (
  contract_id UUID, contract_number INT, lessee_name TEXT,
  distributor_name TEXT, partner_name TEXT, execution_date DATE, expiry_date DATE,
  days_since_expiry INT, is_expired BOOLEAN, max_overdue_days INT, total_unpaid NUMERIC,
  sms_sent BOOLEAN, call_made BOOLEAN, credit_agency_sent BOOLEAN,
  criminal_complaint BOOLEAN, delayed_recovery BOOLEAN, memo TEXT
)
LANGUAGE sql STABLE AS $$
  WITH unpaid_totals AS (
    SELECT
      dd.contract_id,
      SUM(dd.amount - dd.paid_amount) AS total_unpaid,
      MIN(dd.due_date) AS oldest_unpaid_date
    FROM daily_deductions dd
    JOIN contracts c ON c.id = dd.contract_id
    WHERE dd.status <> '납부완료'
      AND dd.amount > dd.paid_amount
      AND dd.due_date <= anchor_date
      AND dd.due_date >= c.execution_date
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)
    GROUP BY dd.contract_id
    HAVING SUM(dd.amount - dd.paid_amount) > 0
  )
  SELECT
    c.id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    COALESCE(c.distributor_name, '')::TEXT,
    COALESCE(p.name, '')::TEXT,
    c.execution_date,
    c.expiry_date,
    CASE WHEN c.expiry_date IS NULL THEN NULL
         ELSE (anchor_date - c.expiry_date)::INT END,
    (c.expiry_date IS NOT NULL AND c.expiry_date < anchor_date),
    (anchor_date - ut.oldest_unpaid_date)::INT,
    ut.total_unpaid::NUMERIC,
    COALESCE(eca.sms_sent, false),
    COALESCE(eca.call_made, false),
    COALESCE(eca.credit_agency_sent, false),
    COALESCE(eca.criminal_complaint, false),
    COALESCE(eca.delayed_recovery, false),
    eca.memo
  FROM contracts c
  JOIN unpaid_totals ut ON ut.contract_id = c.id
  LEFT JOIN partners p ON p.id = c.partner_id
  LEFT JOIN expired_collection_actions eca ON eca.contract_id = c.id
  WHERE c.execution_date >= DATE '2025-10-01'
    AND (
      (c.expiry_date IS NOT NULL AND c.expiry_date < anchor_date)
      OR (anchor_date - ut.oldest_unpaid_date) >= 8
    )
  ORDER BY
    (c.expiry_date IS NOT NULL AND c.expiry_date < anchor_date) DESC,
    (anchor_date - c.expiry_date) DESC NULLS LAST,
    ut.total_unpaid DESC;
$$;
GRANT EXECUTE ON FUNCTION get_unpaid_contracts_all(DATE) TO anon, authenticated;

-- [3] 관리 유의 총판 (anchor_date 기반)
DROP FUNCTION IF EXISTS get_attention_distributors(INT);
DROP FUNCTION IF EXISTS get_attention_distributors(INT, DATE);
CREATE OR REPLACE FUNCTION get_attention_distributors(
  limit_count INT DEFAULT 10,
  anchor_date DATE DEFAULT (CURRENT_DATE - 1)
)
RETURNS TABLE (
  distributor_name TEXT,
  contract_count INT,
  max_overdue_days INT,
  total_unpaid NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH unpaid_by_contract AS (
    SELECT
      dd.contract_id,
      MIN(dd.due_date) AS oldest_unpaid,
      SUM(dd.amount - dd.paid_amount) AS unpaid
    FROM daily_deductions dd
    WHERE dd.status <> '납부완료'
      AND dd.amount > dd.paid_amount
      AND dd.due_date <= anchor_date
    GROUP BY dd.contract_id
    HAVING (anchor_date - MIN(dd.due_date)) >= 21
  ),
  contracts_no_action AS (
    SELECT
      c.distributor_name,
      c.id AS contract_id,
      (anchor_date - ubc.oldest_unpaid)::INT AS overdue_days,
      ubc.unpaid
    FROM contracts c
    JOIN unpaid_by_contract ubc ON ubc.contract_id = c.id
    LEFT JOIN expired_collection_actions eca ON eca.contract_id = c.id
    WHERE c.execution_date >= DATE '2025-10-01'
      AND NOT COALESCE(eca.sms_sent, false)
      AND NOT COALESCE(eca.call_made, false)
      AND NOT COALESCE(eca.credit_agency_sent, false)
      AND NOT COALESCE(eca.criminal_complaint, false)
      AND NOT COALESCE(eca.delayed_recovery, false)
  )
  SELECT
    distributor_name::TEXT,
    COUNT(*)::INT,
    MAX(overdue_days)::INT,
    SUM(unpaid)::NUMERIC
  FROM contracts_no_action
  GROUP BY distributor_name
  ORDER BY MAX(overdue_days) DESC, SUM(unpaid) DESC
  LIMIT limit_count;
$$;
GRANT EXECUTE ON FUNCTION get_attention_distributors(INT, DATE) TO anon, authenticated;
