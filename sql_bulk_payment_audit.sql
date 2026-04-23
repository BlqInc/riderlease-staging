-- ====================================================================
-- 일괄 납부 audit + 롤백 시스템
-- - 모든 일괄 납부는 batch + allocation 으로 기록
-- - 롤백 RPC: 변경 안 된 차감만 안전하게 되돌림 (그 사이 수동 변경된 건 스킵)
-- - 과거 이상 데이터 식별 RPC: audit 없던 시기의 변경 흔적 찾기
-- ====================================================================

-- [1] 배치 헤더
CREATE TABLE IF NOT EXISTS bulk_payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_ids TEXT[],
  partner_names TEXT[],
  date_from DATE,
  date_to DATE,
  input_amount NUMERIC NOT NULL,
  total_distributed NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  contract_count INT NOT NULL DEFAULT 0,
  deduction_count INT NOT NULL DEFAULT 0,
  algorithm TEXT NOT NULL DEFAULT 'cross_contract_date_first',
  status TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'reverted'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reverted_at TIMESTAMPTZ,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_bulk_batches_created ON bulk_payment_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_batches_status ON bulk_payment_batches(status);

-- [2] 분배 명세
CREATE TABLE IF NOT EXISTS bulk_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES bulk_payment_batches(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL,
  deduction_id TEXT NOT NULL,         -- daily_deductions JSON 배열의 elem.id
  due_date DATE,
  prev_paid_amount NUMERIC NOT NULL,
  new_paid_amount NUMERIC NOT NULL,
  prev_status TEXT,
  new_status TEXT,
  payment_amount NUMERIC NOT NULL,    -- new - prev
  spread BOOLEAN DEFAULT false        -- 마지막 부분 분배일에서 동일분배된 경우 true
);
CREATE INDEX IF NOT EXISTS idx_bulk_alloc_batch ON bulk_payment_allocations(batch_id);
CREATE INDEX IF NOT EXISTS idx_bulk_alloc_contract ON bulk_payment_allocations(contract_id);

-- [3] 롤백 RPC
DROP FUNCTION IF EXISTS revert_bulk_payment(UUID);
CREATE OR REPLACE FUNCTION revert_bulk_payment(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_alloc RECORD;
  v_current_json JSONB;
  v_new_json JSONB;
  v_current_elem JSONB;
  v_current_paid NUMERIC;
  v_reverted INT := 0;
  v_skipped INT := 0;
  v_skipped_details JSONB[] := ARRAY[]::JSONB[];
BEGIN
  SELECT status INTO v_status FROM bulk_payment_batches WHERE id = p_batch_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '배치를 찾을 수 없습니다: %', p_batch_id;
  END IF;
  IF v_status = 'reverted' THEN
    RAISE EXCEPTION '이미 롤백된 배치입니다';
  END IF;

  FOR v_alloc IN
    SELECT * FROM bulk_payment_allocations WHERE batch_id = p_batch_id
  LOOP
    -- 현재 contract.daily_deductions JSON 가져오기
    SELECT daily_deductions INTO v_current_json FROM contracts WHERE id = v_alloc.contract_id;
    IF v_current_json IS NULL OR jsonb_typeof(v_current_json) <> 'array' THEN
      v_skipped := v_skipped + 1;
      v_skipped_details := array_append(v_skipped_details,
        jsonb_build_object('reason', 'no_json', 'contract_id', v_alloc.contract_id, 'deduction_id', v_alloc.deduction_id));
      CONTINUE;
    END IF;

    -- 해당 deduction 항목 찾기
    SELECT elem INTO v_current_elem
    FROM jsonb_array_elements(v_current_json) elem
    WHERE elem->>'id' = v_alloc.deduction_id
    LIMIT 1;

    IF v_current_elem IS NULL THEN
      v_skipped := v_skipped + 1;
      v_skipped_details := array_append(v_skipped_details,
        jsonb_build_object('reason', 'deduction_missing', 'contract_id', v_alloc.contract_id, 'deduction_id', v_alloc.deduction_id));
      CONTINUE;
    END IF;

    -- 안전 검사: 현재 paid_amount가 우리가 적용한 new_paid_amount와 일치하는가?
    -- 일치하지 않으면 그 사이에 수동 변경이 있었다는 뜻 → 스킵
    v_current_paid := COALESCE((v_current_elem->>'paid_amount')::numeric, 0);
    IF ABS(v_current_paid - v_alloc.new_paid_amount) > 0.01 THEN
      v_skipped := v_skipped + 1;
      v_skipped_details := array_append(v_skipped_details,
        jsonb_build_object('reason', 'changed_after_batch',
          'contract_id', v_alloc.contract_id, 'deduction_id', v_alloc.deduction_id,
          'expected_paid', v_alloc.new_paid_amount, 'actual_paid', v_current_paid));
      CONTINUE;
    END IF;

    -- 안전. 이전 값으로 되돌림
    SELECT jsonb_agg(
      CASE WHEN elem->>'id' = v_alloc.deduction_id THEN
        jsonb_set(
          jsonb_set(elem, '{paid_amount}', to_jsonb(v_alloc.prev_paid_amount)),
          '{status}',
          to_jsonb(COALESCE(v_alloc.prev_status, '미납'))
        )
      ELSE elem END
    ) INTO v_new_json
    FROM jsonb_array_elements(v_current_json) elem;

    UPDATE contracts SET daily_deductions = v_new_json WHERE id = v_alloc.contract_id;
    v_reverted := v_reverted + 1;
  END LOOP;

  UPDATE bulk_payment_batches
  SET status = 'reverted', reverted_at = NOW()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'reverted', v_reverted,
    'skipped', v_skipped,
    'skipped_details', to_jsonb(v_skipped_details)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION revert_bulk_payment(UUID) TO anon, authenticated;

-- [4] 과거 이상 데이터 식별 (audit 없던 시기)
-- 트리거가 JSON 갱신 시 모든 행을 DELETE+INSERT 하므로 paid_amount=0 노이즈 발생
-- → paid_amount > 0 만 반환하여 실제 납부된 행만 표시. LIMIT으로 PostgREST 1000 제한 우회.
DROP FUNCTION IF EXISTS find_recent_deduction_changes(TEXT, INT);
CREATE OR REPLACE FUNCTION find_recent_deduction_changes(
  p_partner_keyword TEXT,
  p_minutes INT DEFAULT 360  -- 기본 6시간
)
RETURNS TABLE (
  contract_id UUID,
  contract_number INT,
  lessee_name TEXT,
  due_date DATE,
  amount NUMERIC,
  paid_amount NUMERIC,
  status TEXT,
  deduction_id_in_table UUID,
  legacy_id_in_json TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    COALESCE(c.contract_number, 0)::INT,
    COALESCE(c.lessee_name, '')::TEXT,
    dd.due_date,
    dd.amount,
    dd.paid_amount,
    dd.status,
    dd.id,
    dd.legacy_id,
    dd.updated_at
  FROM contracts c
  JOIN partners p ON p.id = c.partner_id
  JOIN daily_deductions dd ON dd.contract_id = c.id
  WHERE p.name ILIKE '%' || p_partner_keyword || '%'
    AND dd.updated_at > NOW() - (p_minutes || ' minutes')::INTERVAL
    AND dd.paid_amount > 0
  ORDER BY dd.updated_at DESC, c.contract_number, dd.due_date
  LIMIT 50000;
$$;
GRANT EXECUTE ON FUNCTION find_recent_deduction_changes(TEXT, INT) TO anon, authenticated;

-- [5] 과거 이상 데이터 일괄 리셋 (paid_amount=0, status=미납)
-- ⚠️ 신중히 사용. 호출 전에 먼저 find_recent_deduction_changes 로 확인.
-- 반환: 영향받은 행 수
DROP FUNCTION IF EXISTS reset_recent_deduction_changes(TEXT, INT);
CREATE OR REPLACE FUNCTION reset_recent_deduction_changes(
  p_partner_keyword TEXT,
  p_minutes INT DEFAULT 360
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_contract RECORD;
  v_new_json JSONB;
  v_target_ids TEXT[];
  v_count INT := 0;
BEGIN
  -- 변경 대상 contract 별로 처리 (legacy_id = JSON elem.id)
  FOR v_contract IN
    SELECT DISTINCT c.id, c.daily_deductions
    FROM contracts c
    JOIN partners p ON p.id = c.partner_id
    JOIN daily_deductions dd ON dd.contract_id = c.id
    WHERE p.name ILIKE '%' || p_partner_keyword || '%'
      AND dd.updated_at > NOW() - (p_minutes || ' minutes')::INTERVAL
      AND dd.paid_amount > 0
  LOOP
    -- 이 계약에서 리셋 대상이 되는 deduction의 legacy_id 모음
    SELECT ARRAY_AGG(dd.legacy_id) INTO v_target_ids
    FROM daily_deductions dd
    WHERE dd.contract_id = v_contract.id
      AND dd.updated_at > NOW() - (p_minutes || ' minutes')::INTERVAL
      AND dd.paid_amount > 0
      AND dd.legacy_id IS NOT NULL;

    IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
      CONTINUE;
    END IF;

    -- JSON 내 해당 항목들의 paid_amount=0, status='미납' 으로 갱신
    SELECT jsonb_agg(
      CASE WHEN elem->>'id' = ANY(v_target_ids) THEN
        jsonb_set(jsonb_set(elem, '{paid_amount}', to_jsonb(0)), '{status}', to_jsonb('미납'::text))
      ELSE elem END
    ) INTO v_new_json
    FROM jsonb_array_elements(v_contract.daily_deductions) elem;

    UPDATE contracts SET daily_deductions = v_new_json WHERE id = v_contract.id;
    v_count := v_count + array_length(v_target_ids, 1);
  END LOOP;

  RETURN jsonb_build_object('reset_count', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION reset_recent_deduction_changes(TEXT, INT) TO anon, authenticated;
