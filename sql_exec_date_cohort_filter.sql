-- ====================================================================
-- 회수 대시보드: 계약 시작일(execution_date) 코호트 필터 추가
-- 예) 2025-11-01 ~ 2025-11-30 사이 계약 시작 건만 필터링
-- ====================================================================

-- [1] 일별 회수 현황
DROP FUNCTION IF EXISTS get_daily_recovery_metrics(DATE, DATE);
DROP FUNCTION IF EXISTS get_daily_recovery_metrics(DATE, DATE, DATE, DATE);
CREATE OR REPLACE FUNCTION get_daily_recovery_metrics(
  from_date DATE,
  to_date DATE,
  exec_from DATE DEFAULT NULL,
  exec_to DATE DEFAULT NULL
)
RETURNS TABLE (
  metric_date DATE,
  expected_amount NUMERIC,
  collected_amount NUMERIC,
  unpaid_amount NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    dd.due_date AS metric_date,
    COALESCE(SUM(dd.amount), 0)::NUMERIC AS expected_amount,
    COALESCE(SUM(dd.paid_amount), 0)::NUMERIC AS collected_amount,
    COALESCE(SUM(
      CASE WHEN dd.status <> '납부완료'
           THEN GREATEST(dd.amount - dd.paid_amount, 0)
           ELSE 0 END
    ), 0)::NUMERIC AS unpaid_amount
  FROM daily_deductions dd
  JOIN contracts c ON c.id = dd.contract_id
  WHERE dd.due_date BETWEEN from_date AND to_date
    AND c.execution_date >= DATE '2025-10-01'
    AND (exec_from IS NULL OR c.execution_date >= exec_from)
    AND (exec_to IS NULL OR c.execution_date <= exec_to)
  GROUP BY dd.due_date
  ORDER BY dd.due_date;
$$;

-- [2] 미납 상세
DROP FUNCTION IF EXISTS get_unpaid_details(DATE, DATE);
DROP FUNCTION IF EXISTS get_unpaid_details(DATE, DATE, DATE, DATE);
CREATE OR REPLACE FUNCTION get_unpaid_details(
  from_date DATE,
  to_date DATE,
  exec_from DATE DEFAULT NULL,
  exec_to DATE DEFAULT NULL
)
RETURNS TABLE (
  deduction_id UUID,
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  distributor_name TEXT,
  partner_name TEXT,
  execution_date DATE,
  expiry_date DATE,
  due_date DATE,
  amount NUMERIC,
  paid_amount NUMERIC,
  owed NUMERIC,
  sms_sent BOOLEAN,
  call_made BOOLEAN,
  credit_agency_sent BOOLEAN,
  criminal_complaint BOOLEAN,
  delayed_recovery BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT
    dd.id AS deduction_id,
    dd.contract_id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    COALESCE(c.distributor_name, '')::TEXT,
    p.name::TEXT,
    c.execution_date,
    c.expiry_date,
    dd.due_date,
    dd.amount,
    dd.paid_amount,
    (dd.amount - dd.paid_amount)::NUMERIC,
    COALESCE(eca.sms_sent, false),
    COALESCE(eca.call_made, false),
    COALESCE(eca.credit_agency_sent, false),
    COALESCE(eca.criminal_complaint, false),
    COALESCE(eca.delayed_recovery, false)
  FROM daily_deductions dd
  JOIN contracts c ON c.id = dd.contract_id
  LEFT JOIN partners p ON p.id = c.partner_id
  LEFT JOIN expired_collection_actions eca ON eca.contract_id = c.id
  WHERE dd.status <> '납부완료'
    AND dd.amount > dd.paid_amount
    AND dd.due_date BETWEEN from_date AND to_date
    AND c.execution_date >= DATE '2025-10-01'
    AND (exec_from IS NULL OR c.execution_date >= exec_from)
    AND (exec_to IS NULL OR c.execution_date <= exec_to)
  ORDER BY dd.due_date ASC, c.contract_number ASC;
$$;

GRANT EXECUTE ON FUNCTION get_daily_recovery_metrics(DATE, DATE, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_unpaid_details(DATE, DATE, DATE, DATE) TO anon, authenticated;
