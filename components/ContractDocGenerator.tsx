import React, { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { read, utils } from 'xlsx-js-style';

// ─── Excel column mapping (Row 6 headers from 고객리스트 sheet) ───
// 0: 계약번호, 1: 계약일, 2: 공급자 성명, 3: 공급자 생년월일, 4: 공급자 휴대전화
// 5: 공급자 회사명, 6: 공급자 사업자번호, 7: 개업일, 8: 공급자 회사주소
// 9: 이용자 성명, 10: 이용자 생년월일, 11: 이용자 휴대전화, 12: 이용자 집주소
// 13: 연대보증인 성명, 14: 연대보증인 생년월일, 15: 연대보증인 휴대전화, 16: 연대보증인 집주소
// 17: 상품명, 18: 계약기간, 19: 상품대수합계, 20: 일 납부금, 21: 합계

interface ExcelRow {
  계약번호: string;
  계약일: string;
  공급자_성명: string;
  공급자_생년월일: string;
  공급자_휴대전화: string;
  공급자_회사명: string;
  공급자_사업자번호: string;
  개업일: string;
  공급자_회사주소: string;
  이용자_성명: string;
  이용자_생년월일: string;
  이용자_휴대전화: string;
  이용자_집주소: string;
  보증인_성명: string;
  보증인_생년월일: string;
  보증인_휴대전화: string;
  보증인_집주소: string;
  상품명: string;
  계약기간: string;
  상품대수합계: string;
  일납부금: string;
}

/** 동일인 여러 기기를 묶은 그룹 */
interface GroupedContract {
  base: ExcelRow;            // 첫 번째 행 (공통 정보)
  items: { 상품명: string; 수량: string; 일납부금: string }[];
  총수량: number;
  총일납부금: number;
}

function parseExcelRow(row: any[]): ExcelRow | null {
  if (!row) return null;
  const str = (v: any) => v == null ? '' : String(v);
  const formatDate = (v: any) => {
    if (!v) return '';
    if (typeof v === 'number') {
      const d = new Date((v - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
    return str(v);
  };
  // 데이터가 하나도 없는 빈 행은 건너뛰기 (이용자 성명 또는 공급자 성명 기준)
  if (!row[2] && !row[9]) return null;
  return {
    계약번호: str(row[0]),
    계약일: formatDate(row[1]),
    공급자_성명: str(row[2]),
    공급자_생년월일: str(row[3]),
    공급자_휴대전화: str(row[4]),
    공급자_회사명: str(row[5]),
    공급자_사업자번호: str(row[6]),
    개업일: formatDate(row[7]),
    공급자_회사주소: str(row[8]),
    이용자_성명: str(row[9]),
    이용자_생년월일: str(row[10]),
    이용자_휴대전화: str(row[11]),
    이용자_집주소: str(row[12]),
    보증인_성명: str(row[13]),
    보증인_생년월일: str(row[14]),
    보증인_휴대전화: str(row[15]),
    보증인_집주소: str(row[16]),
    상품명: str(row[17]),
    계약기간: str(row[18]),
    상품대수합계: str(row[19]),
    일납부금: str(row[20]),
  };
}

/** 동일인+동일계약일 기준으로 행 그룹화 + 계약번호 자동 생성 */
function groupRows(rows: ExcelRow[]): GroupedContract[] {
  const map = new Map<string, ExcelRow[]>();
  for (const row of rows) {
    const key = `${row.이용자_성명}|${row.계약일}|${row.공급자_성명}`;
    const arr = map.get(key) || [];
    arr.push(row);
    map.set(key, arr);
  }

  // 날짜별 순번 카운터 (자동 생성용)
  const dateCounters = new Map<string, number>();

  return Array.from(map.values()).map(group => {
    const items = group.map(r => ({
      상품명: r.상품명,
      수량: r.상품대수합계,
      일납부금: r.일납부금,
    }));
    const 총수량 = items.reduce((s, it) => s + (Number(it.수량) || 0), 0);
    const 총일납부금 = items.reduce((s, it) => s + (Number(it.일납부금) || 0), 0);

    // 계약번호가 없으면 자동 생성: YYYYMMDD + 4자리 순번 (전체 기준 유니크)
    if (!group[0].계약번호) {
      const dateKey = group[0].계약일.replace(/-/g, '');
      const globalSeq = (dateCounters.get(dateKey) || Math.floor(Math.random() * 9000) + 1000);
      dateCounters.set(dateKey, globalSeq + 1);
      group[0].계약번호 = `${dateKey}${String(globalSeq).padStart(4, '0')}`;
    }

    return { base: group[0], items, 총수량, 총일납부금 };
  });
}

function formatCurrency(val: string | number): string {
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString('ko-KR');
}

// ─── XML cell insertion helpers ───

function makeRun(text: string, rPrTemplate?: string): string {
  const rPr = rPrTemplate || '<w:rPr><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find a table row containing a label and set value in the target cell */
function setValueByLabel(xml: string, label: string, cellIndex: number, value: string): string {
  const trRegex = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
  let match;

  while ((match = trRegex.exec(xml)) !== null) {
    const fullRow = match[0];
    const rowContent = match[2];
    const textContent = rowContent.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    const labelClean = label.replace(/\s+/g, '');

    if (!textContent.includes(labelClean)) continue;

    const cellRegex = /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
    const cells: { full: string; start: string; content: string; end: string }[] = [];
    let cm;
    while ((cm = cellRegex.exec(fullRow)) !== null) {
      cells.push({ full: cm[0], start: cm[1], content: cm[2], end: cm[3] });
    }

    if (cellIndex >= cells.length) continue;

    const targetCell = cells[cellIndex];
    const cellText = targetCell.content.replace(/<[^>]+>/g, '').trim();
    if (cellText.length > 0 && cellText !== ' ') continue;

    let runStyle: string | undefined;
    const rPrMatch = rowContent.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (rPrMatch) runStyle = `<w:rPr>${rPrMatch[1]}</w:rPr>`;

    const newRun = makeRun(value, runStyle);
    const finalContent = targetCell.content.replace(/(<\/w:p>)(?![\s\S]*<\/w:p>)/, `${newRun}$1`);
    const newCell = targetCell.start + finalContent + targetCell.end;
    xml = xml.replace(targetCell.full, newCell);
    break;
  }

  return xml;
}

/** Find nth occurrence of a label row and set cell value */
function setValueByRowByOccurrence(xml: string, label: string, occurrence: number, cellIndex: number, value: string): string {
  const trRegex = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
  let match;
  let count = 0;

  while ((match = trRegex.exec(xml)) !== null) {
    const fullRow = match[0];
    const textContent = fullRow.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    const labelClean = label.replace(/\s+/g, '');

    if (!textContent.includes(labelClean)) continue;

    if (count !== occurrence) { count++; continue; }

    const cellRegex = /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
    const cells: { full: string; content: string; start: string; end: string }[] = [];
    let cm;
    while ((cm = cellRegex.exec(fullRow)) !== null) {
      cells.push({ full: cm[0], start: cm[1], content: cm[2], end: cm[3] });
    }

    if (cellIndex >= cells.length) break;

    const targetCell = cells[cellIndex];
    const cellText = targetCell.content.replace(/<[^>]+>/g, '').trim();
    // 이미 내용이 있으면 건너뛰되 루프는 계속 (다음 occurrence 찾기 위해)
    if (cellText.length > 0 && cellText !== ' ') { count++; continue; }

    let runStyle: string | undefined;
    const rPrMatch = match[2].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (rPrMatch) runStyle = `<w:rPr>${rPrMatch[1]}</w:rPr>`;

    const newRun = makeRun(value, runStyle);
    const newContent = targetCell.content.replace(/(<\/w:p>)(?![\s\S]*<\/w:p>)/, `${newRun}$1`);
    const newCell = targetCell.start + newContent + targetCell.end;

    xml = xml.replace(targetCell.full, newCell);
    break;
  }
  return xml;
}

/** Replace existing text in a row */
function replaceTextInRow(xml: string, label: string, oldText: string, newText: string): string {
  const trRegex = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
  let match;

  while ((match = trRegex.exec(xml)) !== null) {
    const fullRow = match[0];
    const textContent = fullRow.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    const labelClean = label.replace(/\s+/g, '');

    if (!textContent.includes(labelClean)) continue;

    const oldEscaped = escapeXml(oldText);
    if (fullRow.includes(oldText) || fullRow.includes(oldEscaped)) {
      const newRow = fullRow
        .replace(new RegExp(escapeRegex(oldText), 'g'), escapeXml(newText))
        .replace(new RegExp(escapeRegex(oldEscaped), 'g'), escapeXml(newText));
      xml = xml.replace(fullRow, newRow);
    }
    break;
  }
  return xml;
}

/** Find a table row where the FIRST cell is exactly the label (not contained in other text) */
function setValueByExactLabel(xml: string, label: string, cellIndex: number, value: string): string {
  const trRegex = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
  let match;

  while ((match = trRegex.exec(xml)) !== null) {
    const fullRow = match[0];
    const rowContent = match[2];

    // Get cells
    const cellRegex = /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
    const cells: { full: string; start: string; content: string; end: string }[] = [];
    let cm;
    while ((cm = cellRegex.exec(fullRow)) !== null) {
      cells.push({ full: cm[0], start: cm[1], content: cm[2], end: cm[3] });
    }

    if (cells.length < 2 || cellIndex >= cells.length) continue;

    // Check if first cell text is exactly the label
    const firstCellText = cells[0].content.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    if (firstCellText !== label.replace(/\s+/g, '')) continue;

    const targetCell = cells[cellIndex];
    const cellText = targetCell.content.replace(/<[^>]+>/g, '').trim();
    if (cellText.length > 0 && cellText !== ' ') continue;

    let runStyle: string | undefined;
    const rPrMatch = rowContent.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (rPrMatch) runStyle = `<w:rPr>${rPrMatch[1]}</w:rPr>`;

    const newRun = makeRun(value, runStyle);
    const finalContent = targetCell.content.replace(/(<\/w:p>)(?![\s\S]*<\/w:p>)/, `${newRun}$1`);
    xml = xml.replace(targetCell.full, targetCell.start + finalContent + targetCell.end);
    break;
  }
  return xml;
}

/** Replace ___ underscores in a paragraph that contains the marker text */
function replaceInlineText(xml: string, marker: string, value: string): string {
  const pRegex = /(<w:p\b[^>]*>)([\s\S]*?)(<\/w:p>)/g;
  let match;

  while ((match = pRegex.exec(xml)) !== null) {
    const fullP = match[0];
    const textContent = fullP.replace(/<[^>]+>/g, '');

    if (!textContent.includes(marker)) continue;

    // The ___ is in the same <w:t> as the marker text
    // Replace: "고객 연락처   ___________________________" → "고객 연락처   010-xxxx-xxxx"
    const underscoreInSameT = new RegExp(
      `(<w:t[^>]*>)(${escapeRegex(marker)}[\\s]*)_{3,}([^<]*)(<\\/w:t>)`
    );
    if (underscoreInSameT.test(fullP)) {
      const newP = fullP.replace(underscoreInSameT, `$1$2${escapeXml(value)}$3$4`);
      xml = xml.replace(fullP, newP);
      break;
    }

    // Fallback: ___ in a separate <w:t>
    const underscoreRun = /(<w:t[^>]*>)([_]{3,})(<\/w:t>)/;
    if (underscoreRun.test(fullP)) {
      const newP = fullP.replace(underscoreRun, `$1${escapeXml(value)}$3`);
      xml = xml.replace(fullP, newP);
      break;
    }
  }
  return xml;
}

/** Set item in the installation table (품목 rows after "NO." header) */
function setItemRow(xml: string, itemIndex: number, productName: string, quantity: string): string {
  const trRegex = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
  let match;
  let foundHeader = false;
  let itemCount = 0;

  while ((match = trRegex.exec(xml)) !== null) {
    const fullRow = match[0];
    const textContent = fullRow.replace(/<[^>]+>/g, '').replace(/\s+/g, '');

    if (textContent.includes('NO.') && textContent.includes('품목')) {
      foundHeader = true;
      continue;
    }

    if (!foundHeader) continue;
    if (!textContent.match(/^[1-8]/)) continue;

    if (itemCount !== itemIndex) { itemCount++; continue; }

    const cellRegex = /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
    const cells: { full: string; content: string; start: string; end: string }[] = [];
    let cm;
    while ((cm = cellRegex.exec(fullRow)) !== null) {
      cells.push({ full: cm[0], start: cm[1], content: cm[2], end: cm[3] });
    }

    if (cells.length < 3) break;

    let runStyle: string | undefined;
    const rPrMatch = match[2].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (rPrMatch) runStyle = `<w:rPr>${rPrMatch[1]}</w:rPr>`;

    // Cell 1: 품목
    const productRun = makeRun(productName, runStyle);
    const newProductContent = cells[1].content.replace(/(<\/w:p>)(?![\s\S]*<\/w:p>)/, `${productRun}$1`);
    xml = xml.replace(cells[1].full, cells[1].start + newProductContent + cells[1].end);

    // Re-find for quantity (because XML changed)
    const trRegex2 = /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g;
    let m2;
    let count2 = 0;
    let foundAgain = false;
    while ((m2 = trRegex2.exec(xml)) !== null) {
      const txt = m2[0].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
      if (txt.includes('NO.') && txt.includes('품목')) { foundAgain = true; continue; }
      if (!foundAgain) continue;
      if (!txt.match(/^[1-8]/)) continue;
      if (count2 !== itemIndex) { count2++; continue; }

      const cellRegex3 = /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g;
      const cells3: { full: string; content: string; start: string; end: string }[] = [];
      let cm3;
      while ((cm3 = cellRegex3.exec(m2[0])) !== null) {
        cells3.push({ full: cm3[0], start: cm3[1], content: cm3[2], end: cm3[3] });
      }
      if (cells3.length >= 3) {
        const qtyRun = makeRun(quantity, runStyle);
        const newQtyContent = cells3[2].content.replace(/(<\/w:p>)(?![\s\S]*<\/w:p>)/, `${qtyRun}$1`);
        xml = xml.replace(cells3[2].full, cells3[2].start + newQtyContent + cells3[2].end);
      }
      break;
    }

    break;
  }
  return xml;
}

function formatDateKorean(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[0]}년 ${parts[1]}월 ${parts[2]}일`;
  return dateStr;
}

/** Fill the document XML with grouped contract data */
function fillDocument(xml: string, group: GroupedContract): string {
  let doc = xml;
  const data = group.base;

  // ─── 계약서 본문 ───
  doc = setValueByLabel(doc, '계약번호', 1, data.계약번호);

  // 공급자
  doc = setValueByLabel(doc, '공급자', 2, data.공급자_성명);
  doc = setValueByLabel(doc, '공급자', 4, data.공급자_회사명);
  doc = setValueByLabel(doc, '사업자번호', 2, data.공급자_사업자번호);
  doc = setValueByLabel(doc, '회사주소', 4, data.공급자_회사주소);
  doc = setValueByRowByOccurrence(doc, '생년월일', 0, 2, data.공급자_생년월일);
  doc = setValueByRowByOccurrence(doc, '휴대전화', 0, 4, data.공급자_휴대전화);

  // 이용자
  doc = setValueByLabel(doc, '이용자', 2, data.이용자_성명);
  doc = setValueByRowByOccurrence(doc, '생년월일', 1, 4, data.이용자_생년월일);
  doc = setValueByLabel(doc, '집주소', 2, data.이용자_집주소);
  doc = setValueByRowByOccurrence(doc, '휴대전화', 1, 4, data.이용자_휴대전화);

  // 연대보증인
  doc = setValueByLabel(doc, '연대보증인', 2, data.보증인_성명);
  doc = setValueByRowByOccurrence(doc, '생년월일', 2, 4, data.보증인_생년월일);
  doc = setValueByRowByOccurrence(doc, '집주소', 1, 2, data.보증인_집주소);
  doc = setValueByRowByOccurrence(doc, '휴대전화', 2, 4, data.보증인_휴대전화);

  // 계약 조건: 여러 기기면 첫 번째 상품명 표시, 일 납부금은 합계
  const productDisplay = group.items.length > 1
    ? `${group.items[0].상품명} 외 ${group.items.length - 1}건`
    : group.items[0].상품명;
  doc = setValueByLabel(doc, '상품명', 2, productDisplay);
  doc = replaceTextInRow(doc, '계약기간', '6개월 (180일)', data.계약기간);
  doc = setValueByLabel(doc, '일납부금', 2, formatCurrency(group.총일납부금));

  // 계약일
  doc = setValueByLabel(doc, '계약일', 2, data.계약일);

  // 서명
  doc = setValueByLabel(doc, '공급자 서명', 1, data.공급자_성명);
  doc = setValueByLabel(doc, '이용자 서명', 3, data.이용자_성명);

  // ─── 배달 업무 확인서 ───
  doc = setValueByRowByOccurrence(doc, '대표자 성명', 0, 1, data.공급자_성명);
  doc = setValueByRowByOccurrence(doc, '사업자번호', 1, 3, data.공급자_사업자번호);
  doc = setValueByLabel(doc, '상호명', 1, data.공급자_회사명);
  doc = setValueByLabel(doc, '개업일', 3, data.개업일);
  doc = setValueByLabel(doc, '사업장 주소', 1, data.공급자_회사주소);
  doc = replaceTextInRow(doc, '확인 일자', '년      월      일', formatDateKorean(data.계약일));
  doc = setValueByRowByOccurrence(doc, '대표자 성명', 1, 1, data.공급자_성명);

  // ─── 설치 확인서 ───
  doc = setValueByLabel(doc, '고객명', 1, data.이용자_성명);
  // 생년월일: Row16 제공항목에도 포함되어 occurrence 4번째가 설치확인서
  doc = setValueByRowByOccurrence(doc, '생년월일', 4, 1, data.이용자_생년월일);
  // 주소: 설치확인서의 "주소" 행 - 정확히 셀이 "주소"만 있는 행 찾기
  doc = setValueByExactLabel(doc, '주소', 1, data.이용자_집주소);
  doc = setValueByLabel(doc, '설치주소', 1, data.이용자_집주소);
  doc = setValueByLabel(doc, '설치일자', 1, data.계약일);

  // 품목 테이블: 각 기기를 별도 행에
  for (let i = 0; i < group.items.length && i < 8; i++) {
    doc = setItemRow(doc, i, group.items[i].상품명, group.items[i].수량);
  }

  // 합계
  doc = setValueByLabel(doc, '합계', 1, String(group.총수량));

  // 고객 연락처, 고객 성명 (테이블 밖 텍스트 영역)
  doc = replaceInlineText(doc, '고객 연락처', data.이용자_휴대전화);
  doc = replaceInlineText(doc, '고객 성명', data.이용자_성명);

  return doc;
}

// ─── Component ───

export const ContractDocGenerator: React.FC = () => {
  const [excelData, setExcelData] = useState<ExcelRow[]>([]);
  const [grouped, setGrouped] = useState<GroupedContract[]>([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] = useState('기본 템플릿');
  const [generating, setGenerating] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Load default template
  const loadDefaultTemplate = useCallback(async () => {
    try {
      const resp = await fetch('/contract_template.docx');
      const buf = await resp.arrayBuffer();
      setTemplateFile(buf);
      setTemplateName('기본 템플릿');
    } catch {
      console.error('기본 템플릿 로드 실패');
    }
  }, []);

  React.useEffect(() => { loadDefaultTemplate(); }, [loadDefaultTemplate]);

  const handleTemplateUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setTemplateFile(reader.result as ArrayBuffer);
      setTemplateName(file.name);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const handleExcelUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const wb = read(reader.result, { type: 'array' });
      const sheetName = wb.SheetNames.find(n => n.includes('고객리스트')) || wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rawData = utils.sheet_to_json<any[]>(sheet, { header: 1 });

      let headerIdx = -1;
      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i] as any[];
        if (row && row[0] && String(row[0]).includes('계약번호')) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx < 0) {
        alert('엑셀에서 "계약번호" 헤더를 찾을 수 없습니다.');
        return;
      }

      const rows: ExcelRow[] = [];
      for (let i = headerIdx + 1; i < rawData.length; i++) {
        const row = rawData[i] as any[];
        const parsed = parseExcelRow(row);
        if (parsed) rows.push(parsed);
      }

      setExcelData(rows);
      const groups = groupRows(rows);
      setGrouped(groups);
      setSelectedRows(new Set(groups.map((_, i) => i)));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const toggleRow = (idx: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === grouped.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(grouped.map((_, i) => i)));
    }
  };

  const generateDocs = useCallback(async () => {
    if (!templateFile || grouped.length === 0) return;
    setGenerating(true);

    try {
      const selected = grouped.filter((_, i) => selectedRows.has(i));
      if (selected.length === 0) { alert('생성할 계약을 선택해주세요.'); return; }

      const templateZip = await JSZip.loadAsync(templateFile);
      const originalXml = await templateZip.file('word/document.xml')!.async('string');

      if (selected.length === 1) {
        const group = selected[0];
        const filledXml = fillDocument(originalXml, group);
        const newZip = await JSZip.loadAsync(templateFile);
        newZip.file('word/document.xml', filledXml);
        const blob = await newZip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const dateStr = group.base.계약일.replace(/-/g, '').slice(2);
        const fileName = `BLQ_rental_contract_${dateStr}_${group.base.이용자_성명}.docx`;
        downloadBlob(blob, fileName);
      } else {
        const outerZip = new JSZip();
        for (const group of selected) {
          const filledXml = fillDocument(originalXml, group);
          const newZip = await JSZip.loadAsync(templateFile);
          newZip.file('word/document.xml', filledXml);
          const docBlob = await newZip.generateAsync({ type: 'blob' });
          const dateStr = group.base.계약일.replace(/-/g, '').slice(2);
          const fileName = `BLQ_rental_contract_${dateStr}_${group.base.이용자_성명}.docx`;
          outerZip.file(fileName, docBlob);
        }
        const zipBlob = await outerZip.generateAsync({ type: 'blob' });
        downloadBlob(zipBlob, `계약서_일괄생성_${new Date().toISOString().slice(0, 10)}.zip`);
      }
    } catch (err) {
      console.error(err);
      alert('문서 생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  }, [templateFile, grouped, selectedRows]);

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <h2 className="text-3xl font-bold text-white">계약서 자동 생성</h2>
      <p className="text-slate-400 text-sm">엑셀 데이터를 워드 템플릿에 채워서 계약서를 자동 생성합니다.</p>

      {/* 템플릿 & 엑셀 업로드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
          <h3 className="text-white font-semibold mb-3">워드 템플릿</h3>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-300 truncate">
              {templateName}
            </div>
            <label className="bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium py-2 px-4 rounded-lg cursor-pointer transition-colors">
              변경
              <input type="file" accept=".docx" onChange={handleTemplateUpload} className="hidden" />
            </label>
          </div>
          <p className="text-slate-500 text-xs mt-2">기본 템플릿이 자동 로드됩니다. 다른 템플릿을 사용하려면 변경하세요.</p>
        </div>

        <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
          <h3 className="text-white font-semibold mb-3">엑셀 데이터</h3>
          {excelFileName ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-slate-700 rounded-lg px-4 py-2.5 text-sm text-green-400 truncate">
                {excelFileName} ({excelData.length}행 → {grouped.length}건 계약)
              </div>
              <label className="bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium py-2 px-4 rounded-lg cursor-pointer transition-colors">
                변경
                <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="hidden" />
              </label>
            </div>
          ) : (
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-lg p-6 text-center transition-colors">
                <p className="text-slate-400 text-sm">클릭하여 엑셀 파일 업로드</p>
                <p className="text-slate-500 text-xs mt-1">고객리스트 시트 기준으로 읽습니다</p>
              </div>
              <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="hidden" />
            </label>
          )}
        </div>
      </div>

      {/* 데이터 미리보기 (그룹화된 계약 기준) */}
      {grouped.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <h3 className="text-white font-semibold">계약 미리보기 ({selectedRows.size}/{grouped.length}건 선택)</h3>
            <div className="flex gap-2">
              <button onClick={toggleAll}
                className="text-xs bg-slate-600 hover:bg-slate-500 text-white py-1.5 px-3 rounded transition-colors">
                {selectedRows.size === grouped.length ? '전체 해제' : '전체 선택'}
              </button>
              <button onClick={generateDocs}
                disabled={generating || selectedRows.size === 0 || !templateFile}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded transition-colors">
                {generating ? '생성 중...' : `계약서 생성 (${selectedRows.size}건)`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700/50 sticky top-0">
                <tr className="text-slate-400">
                  <th className="p-2 w-10">
                    <input type="checkbox" checked={selectedRows.size === grouped.length}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                  </th>
                  <th className="p-2 text-left">계약번호</th>
                  <th className="p-2 text-left">계약일</th>
                  <th className="p-2 text-left">공급자</th>
                  <th className="p-2 text-left">이용자</th>
                  <th className="p-2 text-left">상품명</th>
                  <th className="p-2 text-right">총 대수</th>
                  <th className="p-2 text-right">총 일납부금</th>
                  <th className="p-2 text-left">파일명</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((group, i) => {
                  const dateStr = group.base.계약일.replace(/-/g, '').slice(2);
                  const fileName = `BLQ_rental_contract_${dateStr}_${group.base.이용자_성명}.docx`;
                  const productDisplay = group.items.length > 1
                    ? `${group.items[0].상품명} 외 ${group.items.length - 1}건`
                    : group.items[0].상품명;
                  return (
                    <tr key={i}
                      className={`border-t border-slate-700/50 transition-colors ${selectedRows.has(i) ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'}`}>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={selectedRows.has(i)}
                          onChange={() => toggleRow(i)}
                          className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                      </td>
                      <td className="p-2 text-slate-300 font-mono text-xs">{group.base.계약번호}</td>
                      <td className="p-2 text-slate-300">{group.base.계약일}</td>
                      <td className="p-2 text-slate-300">{group.base.공급자_성명}</td>
                      <td className="p-2 text-slate-300">{group.base.이용자_성명}</td>
                      <td className="p-2 text-slate-300">
                        <span>{productDisplay}</span>
                        {group.items.length > 1 && (
                          <span className="ml-1 text-xs text-indigo-400">({group.items.length}개 기기)</span>
                        )}
                      </td>
                      <td className="p-2 text-right text-slate-300">{group.총수량}</td>
                      <td className="p-2 text-right text-slate-300">{formatCurrency(group.총일납부금)}</td>
                      <td className="p-2 text-indigo-400 text-xs truncate max-w-[200px]">{fileName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
