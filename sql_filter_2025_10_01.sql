-- ====================================================================
-- 회수 대시보드: 2025-10-01 이후 실행된 계약만 포함
-- 차트 RPC + 상세 패널 RPC 둘 다 필터 적용
-- ====================================================================

-- [1] 일별 회수 현황 (차트용)
CREATE OR REPLACE FUNCTION get_daily_recovery_metrics(from_date DATE, to_date DATE)
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
  GROUP BY dd.due_date
  ORDER BY dd.due_date;
$$;

-- [2] 미납 상세 (상세 패널용) - 계약 시작/종료일 포함
DROP FUNCTION IF EXISTS get_unpaid_details(DATE, DATE);
CREATE OR REPLACE FUNCTION get_unpaid_details(from_date DATE, to_date DATE)
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
  owed NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    dd.id AS deduction_id,
    dd.contract_id,
    COALESCE(c.contract_number, 0)::INT AS contract_number,
    COALESCE(c.lessee_name, '')::TEXT AS lessee_name,
    COALESCE(c.distributor_name, '')::TEXT AS distributor_name,
    p.name::TEXT AS partner_name,
    c.execution_date,
    c.expiry_date,
    dd.due_date,
    dd.amount,
    dd.paid_amount,
    (dd.amount - dd.paid_amount)::NUMERIC AS owed
  FROM daily_deductions dd
  JOIN contracts c ON c.id = dd.contract_id
  LEFT JOIN partners p ON p.id = c.partner_id
  WHERE dd.status <> '납부완료'
    AND dd.amount > dd.paid_amount
    AND dd.due_date BETWEEN from_date AND to_date
    AND c.execution_date >= DATE '2025-10-01'
  ORDER BY dd.due_date ASC, c.contract_number ASC;
$$;

GRANT EXECUTE ON FUNCTION get_daily_recovery_metrics(DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_unpaid_details(DATE, DATE) TO anon, authenticated;
