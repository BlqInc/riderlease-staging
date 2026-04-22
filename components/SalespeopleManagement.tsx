import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Partner, Salesperson } from '../types';

interface Props {
  partners: Partner[];
}

export const SalespeopleManagement: React.FC<Props> = ({ partners }) => {
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Salesperson> | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');

  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const fetchAll = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [{ data: sp }, { data: maps }] = await Promise.all([
        (supabase.from('salespeople') as any).select('*').order('name'),
        (supabase.from('salesperson_partners') as any).select('*'),
      ]);
      const partnerByPerson = new Map<string, string[]>();
      (maps || []).forEach((m: any) => {
        const arr = partnerByPerson.get(m.salesperson_id) || [];
        arr.push(m.partner_id);
        partnerByPerson.set(m.salesperson_id, arr);
      });
      setSalespeople((sp || []).map((s: any) => ({ ...s, partner_ids: partnerByPerson.get(s.id) || [], bank_aliases: s.bank_aliases || [] })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    if (!supabase || !editing?.name) return;
    try {
      let id = editing.id;
      if (id) {
        await (supabase.from('salespeople') as any).update({ name: editing.name, bank_aliases: editing.bank_aliases || [] }).eq('id', id);
      } else {
        const { data } = await (supabase.from('salespeople') as any).insert({ name: editing.name, bank_aliases: editing.bank_aliases || [] }).select().single();
        id = data?.id;
      }
      // 매핑 갱신: 기존 삭제 후 재삽입
      if (id) {
        await (supabase.from('salesperson_partners') as any).delete().eq('salesperson_id', id);
        const partnerIds = editing.partner_ids || [];
        if (partnerIds.length > 0) {
          await (supabase.from('salesperson_partners') as any).insert(
            partnerIds.map(pid => ({ salesperson_id: id, partner_id: pid }))
          );
        }
      }
      setEditing(null);
      setAliasInput('');
      setPartnerSearch('');
      await fetchAll();
    } catch (e: any) {
      alert(`저장 실패: ${e.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!supabase || !confirm('이 영업자를 삭제하시겠습니까?')) return;
    await (supabase.from('salespeople') as any).delete().eq('id', id);
    await fetchAll();
  };

  const togglePartner = (pid: string) => {
    const cur = editing?.partner_ids || [];
    const next = cur.includes(pid) ? cur.filter(x => x !== pid) : [...cur, pid];
    setEditing({ ...editing!, partner_ids: next });
  };

  const addAlias = () => {
    if (!aliasInput.trim()) return;
    const cur = editing?.bank_aliases || [];
    if (cur.includes(aliasInput.trim())) return;
    setEditing({ ...editing!, bank_aliases: [...cur, aliasInput.trim()] });
    setAliasInput('');
  };

  const removeAlias = (a: string) => {
    setEditing({ ...editing!, bank_aliases: (editing?.bank_aliases || []).filter(x => x !== a) });
  };

  const filteredPartners = useMemo(() => {
    const kw = partnerSearch.trim().toLowerCase();
    return kw ? partners.filter(p => p.name.toLowerCase().includes(kw)) : partners;
  }, [partners, partnerSearch]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-white">영업자 관리</h2>
        <button onClick={() => { setEditing({ name: '', bank_aliases: [], partner_ids: [] }); setAliasInput(''); setPartnerSearch(''); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg">+ 영업자 추가</button>
      </div>

      {loading ? (
        <p className="text-slate-400">불러오는 중...</p>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="p-3 text-left text-slate-400">영업자명</th>
                <th className="p-3 text-left text-slate-400">은행 입금자명 (별칭)</th>
                <th className="p-3 text-left text-slate-400">담당 파트너사</th>
                <th className="p-3 text-center text-slate-400">관리</th>
              </tr>
            </thead>
            <tbody>
              {salespeople.map(sp => (
                <tr key={sp.id} className="border-t border-slate-700">
                  <td className="p-3 text-white font-medium">{sp.name}</td>
                  <td className="p-3 text-slate-300">{(sp.bank_aliases || []).join(', ') || '-'}</td>
                  <td className="p-3 text-slate-300">{sp.partner_ids.length}개 ({sp.partner_ids.slice(0, 3).map(pid => partnerMap.get(pid)).join(', ')}{sp.partner_ids.length > 3 ? '...' : ''})</td>
                  <td className="p-3 text-center">
                    <button onClick={() => { setEditing(sp); setAliasInput(''); setPartnerSearch(''); }} className="text-yellow-400 hover:text-yellow-300 mr-3">수정</button>
                    <button onClick={() => handleDelete(sp.id)} className="text-red-400 hover:text-red-300">삭제</button>
                  </td>
                </tr>
              ))}
              {salespeople.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-400">등록된 영업자가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-700">
              <h3 className="text-xl font-bold text-white">{editing.id ? '영업자 수정' : '영업자 추가'}</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">영업자 이름</label>
                <input type="text" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-1 block">은행 입금자명 별칭 (가끔 다르게 들어올 때)</label>
                <div className="flex gap-2">
                  <input type="text" value={aliasInput} onChange={e => setAliasInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAlias())}
                    placeholder="별칭 입력 후 추가"
                    className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button onClick={addAlias} className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm">추가</button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(editing.bank_aliases || []).map(a => (
                    <span key={a} className="bg-slate-700 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1">
                      {a}
                      <button onClick={() => removeAlias(a)} className="text-red-400 hover:text-red-300 ml-1">✕</button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-1 block">담당 파트너사 ({(editing.partner_ids || []).length}개 선택)</label>
                <input type="text" value={partnerSearch} onChange={e => setPartnerSearch(e.target.value)}
                  placeholder="파트너사 검색..."
                  className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <div className="max-h-64 overflow-y-auto border border-slate-700 rounded-lg p-2 space-y-1">
                  {filteredPartners.map(p => (
                    <label key={p.id} className="flex items-center gap-2 p-1 hover:bg-slate-700/50 rounded cursor-pointer">
                      <input type="checkbox" checked={(editing.partner_ids || []).includes(p.id)} onChange={() => togglePartner(p.id)}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                      <span className="text-sm text-white">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-slate-700 flex justify-end gap-2">
              <button onClick={() => { setEditing(null); setAliasInput(''); setPartnerSearch(''); }}
                className="bg-slate-600 hover:bg-slate-700 text-white px-6 py-2 rounded-lg">취소</button>
              <button onClick={handleSave} disabled={!editing.name?.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-lg">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
