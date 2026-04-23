// 일괄 납부 분배 계획 (pure function)
// 새 알고리즘: 여러 계약을 가로질러 가장 오래된 날짜부터 일별로 분배
// 마지막 미충당일에는 그날 활성 계약자들에게 동일 금액 스프레드

export interface PlannerInputDeduction {
  id: string;
  date: string;
  amount: number;
  paid_amount: number;
  status: string;
}

export interface PlannerInputContract {
  id: string;
  daily_deductions: PlannerInputDeduction[];
}

export interface PlannerAllocation {
  contract_id: string;
  deduction_id: string;
  due_date: string;
  prev_paid: number;
  new_paid: number;
  prev_status: string;
  new_status: string;
  payment: number;     // new_paid - prev_paid
  spread: boolean;     // 마지막 분배일 동일 분배 여부
}

export interface PlannerResult {
  allocations: PlannerAllocation[];
  total_distributed: number;
  remaining: number;
  affected_contract_count: number;
  algorithm: 'cross_contract_date_first';
}

/**
 * 새 분배 알고리즘
 * 1. 모든 계약의 (dateFrom~dateTo) 미납 차감을 한 풀에 모음
 * 2. 날짜 오름차순으로 그룹화
 * 3. 각 날짜별로 그날 미수합계를 전부 충당할 만큼 남으면 모두 납부완료 처리
 * 4. 모자라는 날에는 그날 계약자 수로 균등 분배 (각 owed로 클램프)
 */
export function planBulkPayment(
  contracts: PlannerInputContract[],
  dateFrom: string,
  dateTo: string,
  inputAmount: number
): PlannerResult {
  // 1. Pool
  type PoolItem = {
    contract_id: string;
    deduction_id: string;
    date: string;
    amount: number;
    paid_amount: number;
    status: string;
  };
  const pool: PoolItem[] = [];
  for (const c of contracts) {
    for (const d of c.daily_deductions || []) {
      if (d.status === '납부완료') continue;
      if (d.date < dateFrom || d.date > dateTo) continue;
      const owed = (d.amount || 0) - (d.paid_amount || 0);
      if (owed <= 0) continue;
      pool.push({
        contract_id: c.id,
        deduction_id: d.id,
        date: d.date,
        amount: d.amount,
        paid_amount: d.paid_amount,
        status: d.status,
      });
    }
  }

  // 2. Group by date
  const byDate = new Map<string, PoolItem[]>();
  for (const item of pool) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date)!.push(item);
  }
  const sortedDates = Array.from(byDate.keys()).sort();

  // 3. Distribute
  const allocations: PlannerAllocation[] = [];
  let remaining = inputAmount;
  const affectedContracts = new Set<string>();

  for (const date of sortedDates) {
    if (remaining <= 0) break;
    const group = byDate.get(date)!;
    const totalOwedToday = group.reduce((s, it) => s + (it.amount - it.paid_amount), 0);

    if (remaining >= totalOwedToday) {
      // 그날 전부 납부완료
      for (const it of group) {
        const newPaid = it.amount;
        allocations.push({
          contract_id: it.contract_id,
          deduction_id: it.deduction_id,
          due_date: it.date,
          prev_paid: it.paid_amount,
          new_paid: newPaid,
          prev_status: it.status,
          new_status: '납부완료',
          payment: newPaid - it.paid_amount,
          spread: false,
        });
        affectedContracts.add(it.contract_id);
      }
      remaining -= totalOwedToday;
    } else {
      // 동일 분배 (각 계약자별 owed로 클램프)
      const perShare = Math.floor(remaining / group.length);
      let usedThisDay = 0;
      for (const it of group) {
        const owed = it.amount - it.paid_amount;
        const pay = Math.min(perShare, owed);
        if (pay <= 0) continue;
        const newPaid = it.paid_amount + pay;
        const newStatus =
          newPaid >= it.amount ? '납부완료'
            : newPaid > 0 ? '부분납부'
            : it.status;
        allocations.push({
          contract_id: it.contract_id,
          deduction_id: it.deduction_id,
          due_date: it.date,
          prev_paid: it.paid_amount,
          new_paid: newPaid,
          prev_status: it.status,
          new_status: newStatus,
          payment: pay,
          spread: true,
        });
        affectedContracts.add(it.contract_id);
        usedThisDay += pay;
      }
      remaining -= usedThisDay;
      break; // 부분일 이후로는 더 진행하지 않음
    }
  }

  return {
    allocations,
    total_distributed: inputAmount - remaining,
    remaining,
    affected_contract_count: affectedContracts.size,
    algorithm: 'cross_contract_date_first',
  };
}
