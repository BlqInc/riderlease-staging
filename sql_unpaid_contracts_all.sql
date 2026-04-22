-- ====================================================================
-- 미수가 있는 모든 계약 조회 (만료/비만료 구분)
-- 회수관리 탭 "미수 계약 회수 관리" 섹션에서 사용
-- ====================================================================

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
  days_since_expiry INT,  -- 양수: 만료 경과, 음수: 만료까지 남은 일수, NULL: 만료일 없음
  is_expired BOOLEAN,
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
    SELECT dd.contract_id, SUM(dd.amount - dd.paid_amount) AS total_unpaid
    FROM daily_deductions dd
    WHERE dd.status <> '납부완료'
      AND dd.amount > dd.paid_amount
    GROUP BY dd.contract_id
    HAVING SUM(dd.amount - dd.paid_amount) > 0
  )
  SELECT
    c.id AS contract_id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    COALESCE(c.distributor_name, '')::TEXT,
    COALESCE(p.name, '')::TEXT AS partner_name,
    c.execution_date,
    c.expiry_date,
    CASE
      WHEN c.expiry_date IS NULL THEN NULL
      ELSE (CURRENT_DATE - c.expiry_date)::INT
    END AS days_since_expiry,
    (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) AS is_expired,
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
  ORDER BY
    (c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE) DESC,
    days_since_expiry DESC NULLS LAST,
    ut.total_unpaid DESC;
$$;

GRANT EXECUTE ON FUNCTION get_unpaid_contracts_all() TO anon, authenticated;
