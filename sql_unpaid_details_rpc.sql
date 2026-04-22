-- ====================================================================
-- 회수 대시보드 - 미납 상세 조회 RPC
-- 차트 미납 막대 클릭 시 호출됨
-- Supabase 1000건 제한 우회 + 서버사이드 JOIN으로 속도 개선
-- ====================================================================

CREATE OR REPLACE FUNCTION get_unpaid_details(from_date DATE, to_date DATE)
RETURNS TABLE (
  deduction_id UUID,
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  distributor_name TEXT,
  partner_name TEXT,
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
  ORDER BY dd.due_date ASC, c.contract_number ASC;
$$;

GRANT EXECUTE ON FUNCTION get_unpaid_details(DATE, DATE) TO anon, authenticated;

-- 테스트: 오늘까지 미납 상세
-- SELECT * FROM get_unpaid_details(CURRENT_DATE - 30, CURRENT_DATE);
