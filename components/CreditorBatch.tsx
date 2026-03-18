import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import XLSX from 'xlsx-js-style';
import { Contract } from '../types';
import { CloseIcon } from './icons/IconComponents';
import { supabase } from '../lib/supabaseClient';

interface Props {
  contracts: Contract[];
}

interface Rect { x: number; y: number; w: number; h: number; }

interface MaskingSession {
  contractId: string;
  docType: string;
  file: File;
  url: string;
  masks: Rect[];
}

// ── Helpers ────────────────────────────────────────────────
const ssnToDate = (ssn: string | null) => (ssn && ssn.length >= 6 ? ssn.substring(0, 6) : '');

const formatProductName = (c: Contract | Partial<Contract>, edits?: Partial<Contract>): string => {
  const merged = { ...c, ...edits };
  const device = (merged.device_name || '').replace(/\s+/g, '');
  const dist = merged.distributor_name || '';
  const units = merged.units_required || 1;
  return `${device}(${dist})${units > 1 ? '_' + units + '대' : ''}`;
};

const get = (c: Contract, edits: Partial<Contract>, field: keyof Contract): any =>
  (edits as any)[field] !== undefined ? (edits as any)[field] : (c as any)[field];


// ── Excel styles ───────────────────────────────────────────
const BORDER_ALL = {
  top:    { style: 'thin', color: { rgb: '000000' } },
  left:   { style: 'thin', color: { rgb: '000000' } },
  right:  { style: 'thin', color: { rgb: '000000' } },
  bottom: { style: 'thin', color: { rgb: '000000' } },
};
const ACC_FMT = '_-* #,##0.00_-;_-* -#,##0.00_-;_-* "-"??_-;_-@_-';

// ── 헤더 스타일 (원본 색상 기준) ─────────────────────────
const makeHdr = (rgb: string) => ({
  fill: { patternType: 'solid', fgColor: { rgb } },
  border: BORDER_ALL,
  font: { bold: true, sz: 10, color: { rgb: '000000' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
});
// 고객리스트 헤더 색상
const HDR_SUPPLIER = makeHdr('DCEAF7'); // 공급자·연대보증인 (연파랑)
const HDR_BUYER    = makeHdr('D9F2D0'); // 구매자 (연초록)
const HDR_YELLOW   = makeHdr('FFFF00'); // 성별, 상품명, 수량, 일출금액
// 상품리스트 헤더 색상
const HDR_FORMULA  = makeHdr('F0F6F9'); // 수식열 (아주 연한 파랑)
const HDR_SUPPLY   = makeHdr('83CBEB'); // 공급대금·총판관리 (하늘)

// ── 데이터 셀 스타일 ─────────────────────────────────────
// 흰 배경 텍스트 (고객리스트, 총판관리 데이터)
const STYLE_DATA = {
  border: BORDER_ALL,
  alignment: { vertical: 'center', wrapText: false },
  font: { sz: 10 },
};
// 흰 배경 숫자 (정렬 우측)
const STYLE_DATA_NUM = {
  border: BORDER_ALL,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { sz: 10 },
};
// 흰 배경 회계 서식 (고객리스트 일출금액, 상품리스트 G·H·I·J)
const STYLE_DATA_ACC = {
  border: BORDER_ALL,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { sz: 10 },
  numFmt: ACC_FMT,
};
// 노란 배경 입력 텍스트 (상품리스트 B·C)
const STYLE_INPUT = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
  border: BORDER_ALL,
  alignment: { vertical: 'center', wrapText: false },
  font: { sz: 10 },
};
// 노란 배경 정수 (상품리스트 F)
const STYLE_INPUT_NUM = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
  border: BORDER_ALL,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { sz: 10 },
};
// 노란 배경 회계 (상품리스트 D·E)
const STYLE_INPUT_ACC = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
  border: BORDER_ALL,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { sz: 10 },
  numFmt: ACC_FMT,
};
// 흰 배경 수식 + 회계 (상품리스트 G·I)
const STYLE_FORMULA_ACC = {
  border: BORDER_ALL,
  alignment: { horizontal: 'right', vertical: 'center' },
  font: { sz: 10 },
  numFmt: ACC_FMT,
};

const STYLE_NOTE  = { font: { color: { rgb: 'FF0000' }, sz: 9, italic: true } };
const STYLE_TITLE = { font: { bold: true, sz: 11, color: { rgb: '1F4E79' } } };

const cStr = (v: string, s: any) => ({ v, t: 's', s });
const cNum = (v: number, s: any, f?: string) => ({ v, t: 'n', s, ...(f ? { f } : {}) });

// ── Build Excel workbook ──────────────────────────────────
function buildWorkbook(
  selected: Contract[],
  allEdits: Record<string, Partial<Contract>>,
  allContracts: Contract[],
) {
  const wb = { SheetNames: [] as string[], Sheets: {} as Record<string, any> };

  // ── Sheet 1: 고객리스트 ──
  const ws1: Record<string, any> = {};
  const hdr1 = [
    '접수일자','공급자 성명','공급자 생년월일','공급자 휴대전화','공급자 회사명',
    '공급자 사업자번호','공급자 회사주소','구매자 성명','구매자 생년월일','구매자 휴대전화',
    '성별(남,여)','구매자 집주소','연대보증인 성명','연대보증인 생년월일','연대보증인 휴대전화',
    '연대보증인 집주소','상품명','상품대수합계','일출금액',
  ];
  const colCount1 = hdr1.length; // 19

  // Row 1 (r=0): 안내 메모
  ws1['A1'] = cStr(
    '* 모든 주소 기재시 전자계약서상 원활한 기재를 위해 엑셀함수 [=len(해당셀)] 기준 43 이하로 기재 요청  ' +
    '* 아래 예시와 동일한 양식으로 기재 요청 ("-" 표기 필수)  ' +
    '* 모든 총판 띄어쓰기 금지',
    STYLE_NOTE,
  );

  // Row 2 (r=1): 글자수 제한 힌트
  ws1['G2'] = cStr('(28자 이내)', { font: { sz: 8, color: { rgb: 'FF0000' } } });
  ws1['L2'] = cStr('(30자 이내)', { font: { sz: 8, color: { rgb: 'FF0000' } } });
  ws1['P2'] = cStr('(24자 이내)', { font: { sz: 8, color: { rgb: 'FF0000' } } });

  // Row 3 (r=2): 헤더 — 열 그룹별 색상
  // A-G: 공급자(연파랑), H-L: 구매자(연초록, K=노랑), M-P: 연대보증인(연파랑), Q-S: 상품(노랑)
  const hdr1Styles = [
    HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, // A~G
    HDR_BUYER,    HDR_BUYER,    HDR_BUYER,    HDR_YELLOW,   HDR_BUYER,   // H~L
    HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, HDR_SUPPLIER, // M~P
    HDR_YELLOW,   HDR_YELLOW,   HDR_YELLOW,  // Q~S
  ];
  hdr1.forEach((h, ci) => {
    ws1[XLSX.utils.encode_cell({ c: ci, r: 2 })] = cStr(h, hdr1Styles[ci]);
  });

  // 데이터 행 (row 4~ = r=3~)
  selected.forEach((c, ri) => {
    const edits = allEdits[c.id] || {};
    const r = ri + 3; // 0-indexed excel row
    const excelRowNum = r + 1; // 1-based Excel row number

    const homeAddr = get(c, edits, 'lessee_home_address') || get(c, edits, 'lessee_business_address') || '';

    // 열 A~R: 입력 셀 (노란색)
    const inputCols: string[] = [
      get(c, edits, 'contract_date') || '',          // A: 접수일자
      get(c, edits, 'distributor_rep_name') || '',   // B: 공급자 성명 (대표자명만, fallback 없음)
      ssnToDate(get(c, edits, 'distributor_ssn_prefix')), // C: 공급자 생년월일
      get(c, edits, 'distributor_contact') || '',    // D: 공급자 휴대전화
      get(c, edits, 'distributor_name') || '',       // E: 공급자 회사명
      get(c, edits, 'distributor_business_number') || '', // F: 공급자 사업자번호
      get(c, edits, 'distributor_address') || '',    // G: 공급자 회사주소
      get(c, edits, 'lessee_name') || '',            // H: 구매자 성명
      ssnToDate(get(c, edits, 'lessee_ssn_prefix')), // I: 구매자 생년월일
      get(c, edits, 'lessee_contact') || '',         // J: 구매자 휴대전화
      get(c, edits, 'lessee_gender') || '',          // K: 성별
      homeAddr,                                       // L: 구매자 집주소
      get(c, edits, 'guarantor_name') || '',         // M: 연대보증인 성명
      ssnToDate(get(c, edits, 'guarantor_ssn_prefix')), // N: 연대보증인 생년월일
      get(c, edits, 'guarantor_phone') || '',        // O: 연대보증인 휴대전화
      get(c, edits, 'guarantor_address') || '',      // P: 연대보증인 집주소
      formatProductName(c, edits),                   // Q: 상품명
      String(get(c, edits, 'units_required') || 1), // R: 수량
    ];
    // 고객리스트 데이터 셀: 원본과 동일하게 흰 배경(배경색 없음)
    inputCols.forEach((val, ci) => {
      ws1[XLSX.utils.encode_cell({ c: ci, r })] = cStr(val, STYLE_DATA);
    });

    // S: 일출금액 - VLOOKUP, 회계 서식
    const unitA = get(c, edits, 'unit_price_a') || 0;
    const unitB = get(c, edits, 'unit_price_b') || 0;
    const units = Number(get(c, edits, 'units_required') || 1);
    const dailyTotal = (unitA + unitB) * units;
    ws1[XLSX.utils.encode_cell({ c: 18, r })] = cNum(
      dailyTotal,
      STYLE_DATA_ACC,
      `=VLOOKUP(Q${excelRowNum},상품리스트!$C:$G,5,0)`,
    );
  });

  ws1['!ref'] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: colCount1 - 1, r: selected.length + 3 } });
  ws1['!cols'] = [
    { wch: 12 },{ wch: 12 },{ wch: 12 },{ wch: 14 },{ wch: 18 },
    { wch: 14 },{ wch: 28 },{ wch: 12 },{ wch: 12 },{ wch: 14 },
    { wch: 8 }, { wch: 30 },{ wch: 12 },{ wch: 12 },{ wch: 14 },
    { wch: 24 },{ wch: 32 },{ wch: 8 }, { wch: 14 },
  ];
  ws1['!rows'] = [{ hpt: 36 }, { hpt: 14 }, { hpt: 40 }];
  (wb.SheetNames as string[]).push('고객리스트');
  (wb.Sheets as any)['고객리스트'] = ws1;

  // ── Sheet 2: 상품리스트 ──
  const ws2: Record<string, any> = {};

  // 안내 노트 (B열, 행 1~8)
  const notes2 = [
    '* 노란색 칸만 기재',
    '* 상품명 공백없이 작성 + (총판명),(총판명(B)) 필수',
    '* 특수상황에만 "_" 사용 (ex.폴드6_512)',
    '* 소수점 이하 없이 기재',
    '* 동일총판 상품 중 일지급액 다르면 상품명 뒤에 (A),(B) 필수 (ex. 아이폰프로256(린몬스터)(B))',
    '* 영업수수료 없는 경우 0원 표기 필수',
    '* 숫자 서식 : 회계+소수점2자리 / 소수점 이하는 0원이어야 함',
    '* 대수 추가시 자동 계산',
  ];
  notes2.forEach((note, i) => {
    ws2[XLSX.utils.encode_cell({ c: 1, r: i })] = cStr(note, STYLE_NOTE);
  });

  // 헤더 (행 10 = r=9) — 기준 엑셀과 동일한 이름
  const hdr2 = [
    '총판명', '상품명',
    '1대 일출금액(A)', '영업수수료(B)',
    '총대수', '최종 일출금액(A+B)',
    '계약기간(일수)', '총매출액',
    '공급대금',
  ];
  // B-F: 노랑(입력), G-I: 아주연한파랑(수식), J: 하늘(공급대금)
  const hdr2Styles = [HDR_YELLOW, HDR_YELLOW, HDR_YELLOW, HDR_YELLOW, HDR_YELLOW, HDR_FORMULA, HDR_FORMULA, HDR_FORMULA, HDR_SUPPLY];
  hdr2.forEach((h, ci) => {
    ws2[XLSX.utils.encode_cell({ c: ci + 1, r: 9 })] = cStr(h, hdr2Styles[ci]);
  });

  // 데이터 (행 11~ = r=10~)
  // 동일 상품명 중복 제거 (상품리스트는 상품 단위)
  const productSeen = new Set<string>();
  const productRows: Array<{ c: Contract; edits: Partial<Contract> }> = [];
  selected.forEach(c => {
    const edits = allEdits[c.id] || {};
    const pName = formatProductName(c, edits);
    if (!productSeen.has(pName)) {
      productSeen.add(pName);
      productRows.push({ c, edits });
    }
  });

  productRows.forEach(({ c, edits }, ri) => {
    const r = ri + 10;
    const rowNum = r + 1;
    const unitA = get(c, edits, 'unit_price_a') || 0;
    const unitB = get(c, edits, 'unit_price_b') || 0;
    const units = Number(get(c, edits, 'units_required') || 1);
    const days = Number(get(c, edits, 'duration_days') || 180);
    const dailyTotal = (unitA + unitB) * units;
    const supplyPrice = get(c, edits, 'unit_supply_price');
    const supplyAmt = supplyPrice ? Number(supplyPrice) * units : 0;
    const pName = formatProductName(c, edits);

    // 입력 셀
    ws2[XLSX.utils.encode_cell({ c: 1, r })] = cStr(get(c, edits, 'distributor_name') || '', STYLE_INPUT);   // B: 총판명
    ws2[XLSX.utils.encode_cell({ c: 2, r })] = cStr(pName, STYLE_INPUT);                                      // C: 상품명
    ws2[XLSX.utils.encode_cell({ c: 3, r })] = cNum(unitA, STYLE_INPUT_ACC);                                  // D: 1대 일출금액(A) — 회계
    ws2[XLSX.utils.encode_cell({ c: 4, r })] = cNum(unitB, STYLE_INPUT_ACC);                                  // E: 영업수수료(B) — 회계
    ws2[XLSX.utils.encode_cell({ c: 5, r })] = cNum(units, STYLE_INPUT_NUM);                                  // F: 총대수 — 정수

    // 수식 셀
    ws2[XLSX.utils.encode_cell({ c: 6, r })] = cNum(dailyTotal, STYLE_FORMULA_ACC, `=(D${rowNum}+E${rowNum})*F${rowNum}`); // G: 최종 일출금액 (수식, 회계)
    ws2[XLSX.utils.encode_cell({ c: 7, r })] = cNum(days, STYLE_DATA_NUM);                                    // H: 계약기간 (흰색)
    ws2[XLSX.utils.encode_cell({ c: 8, r })] = cNum(dailyTotal * days, STYLE_FORMULA_ACC, `=G${rowNum}*H${rowNum}`); // I: 총매출액 (수식, 회계)

    // J: 공급대금 (흰색, 회계) — 원본 데이터셀 배경없음
    ws2[XLSX.utils.encode_cell({ c: 9, r })] = cNum(supplyAmt, STYLE_DATA_ACC);
  });

  ws2['!ref'] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 9, r: productRows.length + 10 } });
  ws2['!cols'] = [
    { wch: 3 },{ wch: 18 },{ wch: 30 },{ wch: 16 },{ wch: 16 },
    { wch: 10 },{ wch: 16 },{ wch: 12 },{ wch: 18 },{ wch: 20 },
  ];
  ws2['!rows'] = Array(9).fill({ hpt: 15 }).concat([{ hpt: 40 }]).concat(productRows.map(() => ({ hpt: 22 })));
  (wb.SheetNames as string[]).push('상품리스트');
  (wb.Sheets as any)['상품리스트'] = ws2;

  // ── Sheet 3: 총판관리 (전체 계약 기준 모든 총판) ──
  const ws3: Record<string, any> = {};

  // 안내
  ws3['A1'] = cStr('* 총판관리 시트는 시스템에 등록된 모든 총판 정보입니다.', STYLE_NOTE);

  // 헤더 (r=1)
  const hdr3 = ['총판명','공급자 성명','공급자 생년월일','공급자 휴대전화','공급자 사업자번호','공급자 회사주소'];
  hdr3.forEach((h, ci) => { ws3[XLSX.utils.encode_cell({ c: ci, r: 1 })] = cStr(h, HDR_SUPPLY); }); // 83CBEB

  // 전체 계약에서 고유 총판 목록 (allContracts 기준)
  const distSeen = new Set<string>();
  const distRows: Contract[] = [];
  allContracts.forEach(c => {
    const key = c.distributor_name || '';
    if (key && !distSeen.has(key)) { distSeen.add(key); distRows.push(c); }
  });

  distRows.forEach((c, ri) => {
    const edits = allEdits[c.id] || {};
    const row3 = [
      get(c, edits, 'distributor_name') || '',
      get(c, edits, 'distributor_rep_name') || '',          // 공급자 성명 = 대표자 성명
      ssnToDate(get(c, edits, 'distributor_ssn_prefix')),
      get(c, edits, 'distributor_contact') || '',
      get(c, edits, 'distributor_business_number') || '',
      get(c, edits, 'distributor_address') || '',
    ];
    row3.forEach((val, ci) => {
      ws3[XLSX.utils.encode_cell({ c: ci, r: ri + 2 })] = cStr(String(val), STYLE_DATA);
    });
  });

  ws3['!ref'] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 5, r: distRows.length + 2 } });
  ws3['!cols'] = [{ wch: 22 },{ wch: 14 },{ wch: 12 },{ wch: 16 },{ wch: 16 },{ wch: 38 }];
  ws3['!rows'] = [{ hpt: 16 }, { hpt: 36 }];
  (wb.SheetNames as string[]).push('총판관리');
  (wb.Sheets as any)['총판관리'] = ws3;

  // ── Sheet 4: 접수가이드 ──
  const ws4: Record<string, any> = {};

  const guideData: Array<{ text: string; indent?: boolean; title?: boolean }> = [
    { text: '📋 접수가이드', title: true },
    { text: '' },
    { text: '[고객리스트 탭]', title: true },
    { text: '* 모든 주소 기재시 전자계약서상 원활한 기재를 위해 엑셀함수 [=len(해당셀)] 기준 43 이하로 기재 요청' },
    { text: '* 아래 예시와 동일한 양식으로 기재 요청 ("-" 표기 필수)' },
    { text: '* 모든 총판 띄어쓰기 금지' },
    { text: '* 동일 총판인데 대표자 다를 경우 총판명 뒤에 공백없이 (B) 기재 필수' },
    { text: '* 행 1개 = 계약서 1개' },
    { text: '* 라이더별, 상품별 전부 구분하여 행 기재해야 함. (상품등록조건 확인 필수)' },
    { text: '' },
    { text: '[상품리스트 탭]', title: true },
    { text: '* 노란색 칸만 기재' },
    { text: '* 상품명 공백없이 작성 + (총판명),(총판명(B)) 필수' },
    { text: '* 특수상황에만 "_" 사용 (ex.폴드6_512)' },
    { text: '* 소수점 이하 없이 기재' },
    { text: '* 동일총판 상품 중 일지급액 다르면 상품명 뒤에 (A),(B) 필수 (ex. 아이폰프로256(린몬스터)(B))' },
    { text: '* 영업수수료 없는 경우 0원 표기 필수' },
    { text: '* 숫자 서식 : 회계+소수점2자리 / 소수점 이하는 0원이어야 함' },
    { text: '' },
    { text: '[접수양식]', title: true },
    { text: '* 다량접수시 총판 구분 없이 엑셀 합쳐서 저장 및 발송' },
    { text: '' },
    { text: '▶ 접수건 파일명 양식', title: true },
    { text: 'ex. 상품구매 및 이용계약서 251024_생각효성,메가_10대', indent: true },
    { text: '→ 엑셀파일 내용 보면서 구분 가능할 정도로만 간단하게 총판명 줄여서 기재', indent: true },
    { text: '→ 계약건수 아닌 총 대수로 기재', indent: true },
    { text: '' },
    { text: '▶ 접수서류 파일명 양식', title: true },
    { text: 'ex1. 총판(=사업자등록증상 총판명)', indent: true },
    { text: '메가라이더스_사업자등록증.jpg', indent: true },
    { text: 'ex2. 총판대표', indent: true },
    { text: '메가라이더스_대표자_정혜미_신분증.jpg', indent: true },
    { text: 'ex3. 라이더', indent: true },
    { text: '메가라이더스_라이더_권혁규_신분증.jpg', indent: true },
    { text: '' },
    { text: '[총판관리 탭]', title: true },
    { text: '* 시스템에 등록된 전체 총판 목록이 자동으로 채워집니다.' },
    { text: '* 총판별 대표자 정보(성명, 생년월일, 연락처, 사업자번호, 주소)를 확인하세요.' },
  ];

  const STYLE_GUIDE_TITLE = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
    font: { bold: true, sz: 11 },
  };
  guideData.forEach((item, ri) => {
    if (!item.text) return;
    const col = item.indent ? 1 : 0;
    const style = item.title ? STYLE_GUIDE_TITLE : STYLE_NOTE;
    ws4[XLSX.utils.encode_cell({ c: col, r: ri })] = cStr(item.text, style);
  });

  ws4['!ref'] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 1, r: guideData.length } });
  ws4['!cols'] = [{ wch: 75 }, { wch: 65 }];
  (wb.SheetNames as string[]).push('접수가이드');
  (wb.Sheets as any)['접수가이드'] = ws4;

  return wb;
}

// ── Masking Modal ─────────────────────────────────────────
const MaskingModal: React.FC<{
  session: MaskingSession;
  onSave: (masks: Rect[]) => void;
  onClose: () => void;
}> = ({ session, onSave, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [masks, setMasks] = useState<Rect[]>(session.masks);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    masks.forEach(m => ctx.fillRect(m.x, m.y, m.w, m.h));
    if (currentRect) ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
  }, [masks, currentRect]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current; if (!canvas) return;
      const scale = Math.min(1, 760 / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      redraw();
    };
    img.src = session.url;
  }, []); // eslint-disable-line

  useEffect(() => { redraw(); }, [redraw]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!; const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };

  const download = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `마스킹_${session.docType}_${session.file.name.replace(/\.[^.]+$/, '')}.png`;
      a.click(); URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[70] p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="font-bold text-white">{session.docType} 마스킹 · {session.file.name}</h3>
          <div className="flex gap-2">
            <button onClick={() => setMasks(p => p.slice(0, -1))} className="bg-slate-700 hover:bg-slate-600 text-white py-1 px-3 rounded text-sm">↩ 취소</button>
            <button onClick={() => setMasks([])} className="bg-slate-700 hover:bg-slate-600 text-white py-1 px-3 rounded text-sm">전체 지우기</button>
            <button onClick={download} className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded text-sm">⬇ 다운로드</button>
            <button onClick={() => { onSave(masks); onClose(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-3 rounded text-sm">완료</button>
            <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded"><CloseIcon className="w-5 h-5 text-slate-400" /></button>
          </div>
        </header>
        <p className="px-4 py-2 text-slate-400 text-xs">클릭+드래그로 마스킹 영역 선택 (주민번호 뒷자리 등)</p>
        <div className="flex-1 overflow-auto flex justify-center p-2">
          <canvas ref={canvasRef}
            onMouseDown={e => { setStartPos(getPos(e)); setDrawing(true); }}
            onMouseMove={e => { if (!drawing) return; const p = getPos(e); setCurrentRect({ x: Math.min(startPos.x, p.x), y: Math.min(startPos.y, p.y), w: Math.abs(p.x - startPos.x), h: Math.abs(p.y - startPos.y) }); }}
            onMouseUp={() => { if (!drawing) return; setDrawing(false); if (currentRect && currentRect.w > 5 && currentRect.h > 5) setMasks(prev => [...prev, currentRect]); setCurrentRect(null); }}
            onMouseLeave={() => { if (drawing) { setDrawing(false); setCurrentRect(null); } }}
            className="cursor-crosshair" style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>
      </div>
    </div>
  );
};

// ── Inline edit cell ──────────────────────────────────────
const EditCell: React.FC<{
  value: string | number | null;
  field: string;
  type?: 'text' | 'number';
  placeholder?: string;
  options?: string[];
  onChange: (field: string, value: any) => void;
  onSave: () => void;
}> = ({ value, field, type = 'text', placeholder, options, onChange, onSave }) => {
  const displayVal = value ?? '';
  const cls = `w-full bg-slate-600 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 ${!displayVal ? 'border border-yellow-500/60' : 'border border-slate-500'}`;
  if (options) {
    return (
      <select value={String(displayVal)} onChange={e => { onChange(field, e.target.value); }} onBlur={onSave} className={cls}>
        <option value="">선택</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input type={type} value={displayVal === null ? '' : String(displayVal)} placeholder={placeholder}
      onChange={e => onChange(field, type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      onBlur={onSave}
      className={cls} />
  );
};

// ── Doc types for masking ─────────────────────────────────
const DOC_TYPES = ['신분증', '주민등록표', '사업자등록증'] as const;

interface ContractDoc { file: File; url: string; masks: Rect[]; }

// ── Main component ────────────────────────────────────────
export const CreditorBatch: React.FC<Props> = ({ contracts }) => {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingEdits, setPendingEdits] = useState<Record<string, Partial<Contract>>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [contractDocs, setContractDocs] = useState<Record<string, Partial<Record<string, ContractDoc>>>>({});
  const [maskingSession, setMaskingSession] = useState<MaskingSession | null>(null);
  const [mainTab, setMainTab] = useState<'excel' | 'mask'>('excel');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return contracts;
    return contracts.filter(c =>
      (c.lessee_name || '').toLowerCase().includes(q) ||
      (c.distributor_name || '').toLowerCase().includes(q) ||
      (c.device_name || '').toLowerCase().includes(q) ||
      String(c.contract_number).includes(q)
    );
  }, [contracts, search]);

  const selectedContracts = useMemo(() => contracts.filter(c => selectedIds.has(c.id)), [contracts, selectedIds]);

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id)));

  const handleEdit = (contractId: string, field: string, value: any) => {
    setPendingEdits(prev => ({ ...prev, [contractId]: { ...prev[contractId], [field]: value } }));
  };

  const saveContractEdits = async (contractId: string) => {
    const edits = pendingEdits[contractId];
    if (!edits || !supabase) return;
    // 빈 문자열은 저장하지 않음 (실수로 필드 지워도 원본 유지)
    const safeEdits = Object.fromEntries(
      Object.entries(edits).filter(([, v]) => v !== '' && v !== undefined)
    );
    if (Object.keys(safeEdits).length === 0) return;
    setSavingIds(prev => new Set(prev).add(contractId));
    try {
      await supabase.from('contracts').update(safeEdits as any).eq('id', contractId);
    } catch (e) {
      console.error('Save error:', e);
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(contractId); return n; });
    }
  };

  const getVal = (c: Contract, field: keyof Contract) => {
    const edits = pendingEdits[c.id];
    return edits && (edits as any)[field] !== undefined ? (edits as any)[field] : c[field];
  };

  const generateExcel = () => {
    if (selectedContracts.length === 0) return;
    const wb = buildWorkbook(selectedContracts, pendingEdits, contracts);
    const today = new Date();
    const dateStr = `${String(today.getFullYear()).substring(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const distNames = [...new Set(selectedContracts.map(c => (pendingEdits[c.id]?.distributor_name ?? c.distributor_name) || '').filter(Boolean))].slice(0, 3).join(',');
    const totalUnits = selectedContracts.reduce((s, c) => s + ((pendingEdits[c.id]?.units_required ?? c.units_required) || 1), 0);
    XLSX.writeFile(wb, `상품구매및이용계약서${dateStr}_${distNames}_총${totalUnits}대.xlsx`);
  };

  // Masking helpers
  const handleDocUpload = (contractId: string, docType: string, file: File) => {
    const url = URL.createObjectURL(file);
    setContractDocs(prev => ({ ...prev, [contractId]: { ...(prev[contractId] || {}), [docType]: { file, url, masks: [] } } }));
  };

  const openMasking = (contractId: string, docType: string) => {
    const doc = contractDocs[contractId]?.[docType]; if (!doc) return;
    setMaskingSession({ contractId, docType, file: doc.file, url: doc.url, masks: doc.masks });
  };

  const saveMasks = (masks: Rect[]) => {
    if (!maskingSession) return;
    const { contractId, docType } = maskingSession;
    setContractDocs(prev => ({ ...prev, [contractId]: { ...(prev[contractId] || {}), [docType]: { ...prev[contractId]![docType]!, masks } } }));
  };

  const downloadMasked = (contractId: string, docType: string) => {
    const doc = contractDocs[contractId]?.[docType]; if (!doc) return;
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 760 / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'black';
      doc.masks.forEach(m => ctx.fillRect(m.x, m.y, m.w, m.h));
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        const c = contracts.find(x => x.id === contractId);
        a.href = url; a.download = `마스킹_${c?.lessee_name || ''}_${docType}.png`;
        a.click(); URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = doc.url;
  };

  const tabCls = (t: 'excel' | 'mask') =>
    `px-5 py-2 rounded-lg font-bold text-sm transition-colors ${mainTab === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white bg-slate-700'}`;

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">채권사 발송</h2>
          <p className="text-slate-400 text-sm mt-1">계약건 선택 → 누락 정보 입력 → 엑셀 생성 또는 이미지 마스킹</p>
        </div>
        <div className="flex gap-2">
          <button className={tabCls('excel')} onClick={() => setMainTab('excel')}>📊 엑셀 생성</button>
          <button className={tabCls('mask')} onClick={() => setMainTab('mask')}>📷 이미지 마스킹</button>
        </div>
      </div>

      {/* Contract selector */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-4">
          <input type="text" placeholder="계약번호, 라이더명, 총판명, 기종 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-slate-400 text-sm whitespace-nowrap">{selectedIds.size}건 선택</span>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          <label className="flex items-center gap-3 p-2 text-xs text-slate-500 border-b border-slate-700 cursor-pointer hover:bg-slate-700/30">
            <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600" />
            <span>전체 선택 ({filtered.length}건)</span>
          </label>
          {filtered.map(c => {
            const edits = pendingEdits[c.id] || {};
            const hasIssue = !getVal(c, 'distributor_rep_name') || !getVal(c, 'unit_price_a') || !getVal(c, 'guarantor_name');
            return (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer transition-colors">
                <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600 shrink-0" />
                <span className="text-slate-400 text-xs w-10 shrink-0">#{c.contract_number}</span>
                <span className="text-white text-sm font-medium w-20 shrink-0 truncate">{c.lessee_name}</span>
                <span className="text-slate-300 text-xs w-28 shrink-0 truncate">{c.distributor_name}</span>
                <span className="text-slate-400 text-xs flex-1 truncate">{c.device_name} · {c.units_required}대</span>
                {hasIssue
                  ? <span className="text-yellow-400 text-xs shrink-0">⚠ 정보 부족</span>
                  : <span className="text-green-400 text-xs shrink-0">✓ 준비됨</span>
                }
              </label>
            );
          })}
          {filtered.length === 0 && <p className="text-center text-slate-500 py-4 text-sm">검색 결과 없음</p>}
        </div>
      </div>

      {/* ── Excel tab ── */}
      {mainTab === 'excel' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-sm">선택된 {selectedContracts.length}건 → 고객리스트 + 상품리스트 + 총판관리 + 접수가이드 (4개 시트)</p>
            <button onClick={generateExcel} disabled={selectedContracts.length === 0}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-lg transition-colors">
              📊 선택 {selectedContracts.length}건 엑셀 생성
            </button>
          </div>

          {selectedContracts.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-xs min-w-max">
                <thead>
                  <tr className="bg-slate-700 text-slate-300">
                    <th className="p-2 text-left whitespace-nowrap">#</th>
                    <th className="p-2 text-left whitespace-nowrap">공급자 성명<br/><span className="text-yellow-400 font-normal">(대표자명)</span></th>
                    <th className="p-2 text-left whitespace-nowrap">공급자 생년월일</th>
                    <th className="p-2 text-left whitespace-nowrap">구매자 성명<br/><span className="text-yellow-400 font-normal">(라이더)</span></th>
                    <th className="p-2 text-left whitespace-nowrap">구매자 연락처</th>
                    <th className="p-2 text-left whitespace-nowrap">라이더 생년월일</th>
                    <th className="p-2 text-left whitespace-nowrap">성별</th>
                    <th className="p-2 text-left whitespace-nowrap">라이더 집주소</th>
                    <th className="p-2 text-left whitespace-nowrap">연대보증인</th>
                    <th className="p-2 text-left whitespace-nowrap">보증인 생년월일</th>
                    <th className="p-2 text-left whitespace-nowrap">보증인 전화</th>
                    <th className="p-2 text-left whitespace-nowrap">보증인 주소</th>
                    <th className="p-2 text-left whitespace-nowrap">1대가격(A)</th>
                    <th className="p-2 text-left whitespace-nowrap">수수료(B)</th>
                    <th className="p-2 text-left whitespace-nowrap">1대공급가</th>
                    <th className="p-2 text-left whitespace-nowrap">저장</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedContracts.map(c => {
                    const saving = savingIds.has(c.id);
                    const edits = pendingEdits[c.id] || {};
                    const edited = Object.keys(edits).length > 0;
                    return (
                      <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-700/20">
                        <td className="p-2 text-slate-400 font-mono whitespace-nowrap">#{c.contract_number}<br/><span className="text-slate-500">{c.lessee_name}</span></td>
                        <td className="p-2"><EditCell value={getVal(c,'distributor_rep_name')} field="distributor_rep_name" placeholder="대표자명" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'distributor_ssn_prefix')} field="distributor_ssn_prefix" placeholder="YYMMDD" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'lessee_name')} field="lessee_name" placeholder="라이더명" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'lessee_contact')} field="lessee_contact" placeholder="010-0000-0000" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'lessee_ssn_prefix')} field="lessee_ssn_prefix" placeholder="YYMMDD" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'lessee_gender')} field="lessee_gender" options={['남','여']} onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'lessee_home_address') || getVal(c,'lessee_business_address')} field="lessee_home_address" placeholder="집주소" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'guarantor_name')} field="guarantor_name" placeholder="보증인명" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'guarantor_ssn_prefix')} field="guarantor_ssn_prefix" placeholder="YYMMDD" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'guarantor_phone')} field="guarantor_phone" placeholder="010-0000-0000" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'guarantor_address')} field="guarantor_address" placeholder="주소" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'unit_price_a')} field="unit_price_a" type="number" placeholder="17744" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'unit_price_b') ?? 0} field="unit_price_b" type="number" placeholder="0" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2"><EditCell value={getVal(c,'unit_supply_price')} field="unit_supply_price" type="number" placeholder="공급가" onChange={(f,v)=>handleEdit(c.id,f,v)} onSave={()=>saveContractEdits(c.id)} /></td>
                        <td className="p-2">
                          <button onClick={() => saveContractEdits(c.id)} disabled={!edited || saving}
                            className={`px-2 py-1 rounded text-xs font-bold transition-colors whitespace-nowrap ${edited && !saving ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-600 text-slate-400'}`}>
                            {saving ? '저장중…' : edited ? '💾 저장' : '저장됨'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedContracts.length === 0 && (
            <div className="text-center py-12 text-slate-500"><p className="text-3xl mb-3">📋</p><p>위에서 계약건을 선택하세요</p></div>
          )}
        </div>
      )}

      {/* ── Masking tab ── */}
      {mainTab === 'mask' && (
        <div className="space-y-4">
          {selectedContracts.length === 0 ? (
            <div className="text-center py-12 text-slate-500"><p className="text-3xl mb-3">📋</p><p>위에서 계약건을 선택하세요</p></div>
          ) : (
            selectedContracts.map(c => (
              <div key={c.id} className="bg-slate-800 rounded-xl p-4">
                <div className="mb-3">
                  <span className="text-slate-400 text-xs">#{c.contract_number}</span>
                  <span className="text-white font-bold ml-2">{c.lessee_name}</span>
                  <span className="text-slate-400 text-sm ml-2">· {c.distributor_name} · {c.device_name}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {DOC_TYPES.map(docType => {
                    const doc = contractDocs[c.id]?.[docType];
                    return (
                      <div key={docType} className="bg-slate-700 rounded-lg p-3 space-y-2">
                        <p className="text-slate-300 text-xs font-bold">{docType}</p>
                        {doc ? (
                          <>
                            <p className="text-slate-400 text-xs truncate">{doc.file.name}</p>
                            {doc.masks.length > 0 && <p className="text-yellow-400 text-xs">{doc.masks.length}개 마스킹됨</p>}
                            <div className="flex gap-1">
                              <button onClick={() => openMasking(c.id, docType)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-1 rounded transition-colors">마스킹 편집</button>
                              <button onClick={() => downloadMasked(c.id, docType)} className="bg-green-600 hover:bg-green-700 text-white text-xs py-1 px-2 rounded transition-colors">⬇</button>
                            </div>
                          </>
                        ) : (
                          <label className="block cursor-pointer">
                            <div className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-lg p-4 text-center transition-colors">
                              <p className="text-slate-500 text-xs">클릭하여 업로드</p>
                            </div>
                            <input type="file" accept="image/*"
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleDocUpload(c.id, docType, f); e.target.value = ''; }}
                              className="hidden" />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Masking modal */}
      {maskingSession && <MaskingModal session={maskingSession} onSave={saveMasks} onClose={() => setMaskingSession(null)} />}
    </div>
  );
};
