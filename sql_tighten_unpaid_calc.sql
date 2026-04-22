-- ====================================================================
-- 미수 집계 정확도 개선
-- 1. 건전성 연체 기준 8일+ 로 변경
-- 2. 미수 집계 시 '계약 유효 기간(execution_date ~ expiry_date)' 내 차감만 포함
-- ====================================================================

-- [1] 건전성 요약 (진행중 연체 = 8일+ 연체)
DROP FUNCTION IF EXISTS get_contract_health_summary();
CREATE OR REPLACE FUNCTION get_contract_health_summary()
RETURNS TABLE (
  total_contracts INT,
  healthy_active INT,
  overdue_active INT,
  expired_healthy INT,
  expired_unpaid INT,
  total_expected NUMERIC,
  total_paid NUMERIC,
  total_unpaid NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH valid_deductions AS (
    SELECT dd.contract_id, dd.due_date, dd.amount, dd.paid_amount, dd.status
    FROM daily_deductions dd
    JOIN contracts c ON c.id = dd.contract_id
    WHERE c.execution_date >= DATE '2025-10-01'
      AND dd.due_date <= CURRENT_DATE
      AND dd.due_date >= c.execution_date
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)
  ),
  per_contract AS (
    SELECT
      c.id,
      (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) AS is_expired,
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
    GROUP BY c.id, c.expiry_date
  )
  SELECT
    COUNT(*)::INT,
    -- 진행중 정상: 미수 없거나 연체 8일 미만
    COUNT(*) FILTER (
      WHERE NOT is_expired
        AND (unpaid = 0 OR oldest_unpaid IS NULL OR (CURRENT_DATE - oldest_unpaid) < 8)
    )::INT,
    -- 진행중 연체: 8일+ 연체
    COUNT(*) FILTER (
      WHERE NOT is_expired
        AND unpaid > 0
        AND oldest_unpaid IS NOT NULL
        AND (CURRENT_DATE - oldest_unpaid) >= 8
    )::INT,
    COUNT(*) FILTER (WHERE unpaid = 0 AND is_expired)::INT,
    COUNT(*) FILTER (WHERE unpaid > 0 AND is_expired)::INT,
    SUM(expected)::NUMERIC,
    SUM(paid)::NUMERIC,
    SUM(unpaid)::NUMERIC
  FROM per_contract;
$$;
GRANT EXECUTE ON FUNCTION get_contract_health_summary() TO anon, authenticated;

-- [2] 미수 계약 조회 (계약 유효 기간 내 차감만 집계)
DROP FUNCTION IF EXISTS get_unpaid_contracts_all();
CREATE OR REPLACE FUNCTION get_unpaid_contracts_all()
RETURNS TABLE (
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  distributor_name TEXT,
  partner_name TEXT,
  execution_date DATE,
  expiry_date DATE,
  days_since_expiry INT,
  is_expired BOOLEAN,
  max_overdue_days INT,
  total_unpaid NUMERIC,
  sms_sent BOOLEAN,
  call_made BOOLEAN,
  credit_agency_sent BOOLEAN,
  criminal_complaint BOOLEAN,
  delayed_recovery BOOLEAN,
  memo TEXT
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
      AND dd.due_date <= CURRENT_DATE
      AND dd.due_date >= c.execution_date       -- 계약 시작 후 차감만
      AND (c.expiry_date IS NULL OR dd.due_date <= c.expiry_date)  -- 만료 전 차감만
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
         ELSE (CURRENT_DATE - c.expiry_date)::INT END,
    (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE),
    (CURRENT_DATE - ut.oldest_unpaid_date)::INT,
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
      (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE)
      OR (CURRENT_DATE - ut.oldest_unpaid_date) >= 8
    )
  ORDER BY
    (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) DESC,
    (CURRENT_DATE - c.expiry_date) DESC NULLS LAST,
    ut.total_unpaid DESC;
$$;
GRANT EXECUTE ON FUNCTION get_unpaid_contracts_all() TO anon, authenticated;
