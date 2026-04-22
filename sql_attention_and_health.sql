-- ====================================================================
-- 관리 유의 총판 + 계약 건전성 요약
-- ====================================================================

-- [1] 관리 유의 총판 (21일+ 연체 & 아무 조치 없음)
DROP FUNCTION IF EXISTS get_risky_distributors(INT);
DROP FUNCTION IF EXISTS get_attention_distributors(INT);
CREATE OR REPLACE FUNCTION get_attention_distributors(limit_count INT DEFAULT 10)
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
      AND dd.due_date <= CURRENT_DATE
    GROUP BY dd.contract_id
    HAVING (CURRENT_DATE - MIN(dd.due_date)) >= 21
  ),
  contracts_no_action AS (
    SELECT
      c.distributor_name,
      c.id AS contract_id,
      (CURRENT_DATE - ubc.oldest_unpaid)::INT AS overdue_days,
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

GRANT EXECUTE ON FUNCTION get_attention_distributors(INT) TO anon, authenticated;

-- [2] 계약 건전성 요약 (2025-10-01 이후 실행된 모든 계약)
DROP FUNCTION IF EXISTS get_contract_health_summary();
CREATE OR REPLACE FUNCTION get_contract_health_summary()
RETURNS TABLE (
  total_contracts INT,
  healthy_active INT,       -- 진행중 + 미수 없음
  overdue_active INT,       -- 진행중 + 미수 있음
  expired_healthy INT,      -- 만료 + 미수 없음
  expired_unpaid INT,       -- 만료 + 미수 있음
  total_expected NUMERIC,
  total_paid NUMERIC,
  total_unpaid NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH per_contract AS (
    SELECT
      c.id,
      (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) AS is_expired,
      COALESCE(SUM(dd.amount) FILTER (WHERE dd.due_date <= CURRENT_DATE), 0) AS expected,
      COALESCE(SUM(dd.paid_amount) FILTER (WHERE dd.due_date <= CURRENT_DATE), 0) AS paid,
      COALESCE(SUM(
        CASE WHEN dd.due_date <= CURRENT_DATE AND dd.status <> '납부완료'
             THEN GREATEST(dd.amount - dd.paid_amount, 0)
             ELSE 0 END
      ), 0) AS unpaid
    FROM contracts c
    LEFT JOIN daily_deductions dd ON dd.contract_id = c.id
    WHERE c.execution_date >= DATE '2025-10-01'
    GROUP BY c.id, c.expiry_date
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE unpaid = 0 AND NOT is_expired)::INT,
    COUNT(*) FILTER (WHERE unpaid > 0 AND NOT is_expired)::INT,
    COUNT(*) FILTER (WHERE unpaid = 0 AND is_expired)::INT,
    COUNT(*) FILTER (WHERE unpaid > 0 AND is_expired)::INT,
    SUM(expected)::NUMERIC,
    SUM(paid)::NUMERIC,
    SUM(unpaid)::NUMERIC
  FROM per_contract;
$$;

GRANT EXECUTE ON FUNCTION get_contract_health_summary() TO anon, authenticated;
