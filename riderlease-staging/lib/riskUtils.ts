import { Contract, DeductionStatus } from '../types';

export type RiskLevel = '정상' | '주의' | '위험' | '소송중';

export function classifyRisk(paymentRate: number, isLawsuit: boolean | null): RiskLevel {
  if (isLawsuit) return '소송중';
  if (paymentRate >= 80) return '정상';
  if (paymentRate >= 50) return '주의';
  return '위험';
}

export function computePaymentStats(contract: Contract) {
  const deductions = contract.daily_deductions || [];
  const today = new Date().toISOString().slice(0, 10);

  // 오늘까지 내야 할 금액 (오늘 이전 날짜의 차감 합계)
  const expectedByToday = deductions
    .filter(d => d.date <= today)
    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  // 실제 납부한 금액 (오늘까지 기준)
  const totalPaid = deductions
    .filter(d => d.status === DeductionStatus.PAID)
    .reduce((sum, d) => sum + (Number(d.paid_amount) || Number(d.amount) || 0), 0);

  const totalAmount = Number(contract.total_amount) || 0;

  // 납부율: 오늘까지 내야 할 금액 대비 실제 납부액
  const paymentRate = expectedByToday > 0 ? (totalPaid / expectedByToday) * 100 : (totalPaid > 0 ? 100 : 0);

  // 잔액: 오늘까지 내야 할 금액 - 실제 납부액
  const balance = expectedByToday - totalPaid;

  const overdueDeductions = deductions.filter(
    d => d.date <= today && d.status !== DeductionStatus.PAID
  );
  const overdueDays = overdueDeductions.length > 0
    ? Math.max(0, Math.floor((Date.now() - new Date(overdueDeductions[0].date).getTime()) / (1000 * 3600 * 24)))
    : 0;

  const paidDates = deductions
    .filter(d => d.status === DeductionStatus.PAID)
    .map(d => d.date)
    .sort();
  const lastPaymentDate = paidDates.length > 0 ? paidDates[paidDates.length - 1] : null;

  return { totalPaid, expectedByToday, totalAmount, paymentRate, balance, overdueDays, lastPaymentDate, overdueCount: overdueDeductions.length };
}

export function computeDistributorRisk(contracts: Contract[], distributorName: string) {
  const filtered = contracts.filter(c => c.distributor_name?.trim() === distributorName.trim());
  if (filtered.length === 0) return null;
  const stats = filtered.map(c => computePaymentStats(c));
  const totalExpected = stats.reduce((s, st) => s + st.expectedByToday, 0);
  const totalPaid = stats.reduce((s, st) => s + st.totalPaid, 0);
  const rate = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : (totalPaid > 0 ? 100 : 0);
  const lawsuitCount = filtered.filter(c => c.is_lawsuit).length;
  return { name: distributorName, rate, contractCount: filtered.length, lawsuitCount };
}

export function computeLesseeRisk(contracts: Contract[], lesseeName: string) {
  const filtered = contracts.filter(c => c.lessee_name?.trim() === lesseeName.trim());
  if (filtered.length === 0) return null;
  const stats = filtered.map(c => computePaymentStats(c));
  const totalExpected = stats.reduce((s, st) => s + st.expectedByToday, 0);
  const totalPaid = stats.reduce((s, st) => s + st.totalPaid, 0);
  const rate = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : (totalPaid > 0 ? 100 : 0);
  return { name: lesseeName, rate, contractCount: filtered.length };
}

export const riskColors: Record<RiskLevel, string> = {
  '정상': 'bg-green-500/20 text-green-300',
  '주의': 'bg-yellow-500/20 text-yellow-300',
  '위험': 'bg-red-500/20 text-red-300',
  '소송중': 'bg-purple-500/20 text-purple-300 border border-purple-500/50',
};
