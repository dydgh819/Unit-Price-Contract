// 단가계약 기술지도 관리 - Firestore-backed implementation.
// Data model (Firestore):
//   contracts/{id}: { factory, vendor, bizNo, projectName, location, start, end,
//                      amount, contractDate, contractStart, contractEnd,
//                      dept, manager, email, createdAt }
//   contracts/{id}/history/{historyId}: { start, end, amount, dept, manager, archivedAt }
//   -> each "갱신" archives the current period into history, then updates the
//      parent doc in place. 계약 이력 shows the parent (current) + its history.

import { db } from './firebase-init.js';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  getDocs, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const CONTRACTS_COL = collection(db, 'contracts');

const state = {
  tab: 'all',            // 'all' | 'f1' | 'f2' | 'f3' | 'history'
  filter: 'all',         // status chip filter
  search: '',
  contracts: [],
  loading: true,

  editingId: null,       // null | 'NEW' | contract id currently editable in the table
  sort: { key: null, dir: null }, // dir: null | 'asc' | 'desc'

  bulkOpen: false,
  bulkRows: [],          // parsed preview rows: { raw, values, errors }
  bulkSaving: false,

  mailOpen: false,
  mailContract: null,
  mailBody: '',

  formOpen: false,
  formMode: 'add',       // 'add' | 'edit' | 'renew'
  formContract: null,    // base contract doc for edit/renew
  formValues: null,

  histContractId: null,
  historyEntries: [],
  historyLoading: false,

  toast: '',
  toastShow: false
};

let toastTimer = null;
let unsubHistory = null;

const TAB_DEFS = [
  ['all', '전체보기'],
  ['f1', '1공장'],
  ['f2', '2공장'],
  ['f3', '3공장'],
  ['history', '계약 이력']
];
const FACTORY_OF_TAB = { f1: 1, f2: 2, f3: 3, all: null };
const TABLE_TITLE = { f1: '1공장 계약 관리', f2: '2공장 계약 관리', f3: '3공장 계약 관리', all: '전체 계약 관리' };
const CHIP_DEFS = [
  ['all', '전체'],
  ['OVERDUE', '만료'],
  ['DDAY', '만료임박'],
  ['UPCOMING', '진행중'],
  ['NEED_CONTRACT', '계약 필요']
];
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const FACTORY_COLOR = {
  1: { color: '#2A6FDB', bg: '#EAF1FB' },
  2: { color: '#1F8A5B', bg: '#E7F4EE' },
  3: { color: '#7C5CDB', bg: '#F0ECFB' }
};
const STATUS_STYLE = {
  OVERDUE: { color: '#E53935', bg: '#FDECEC' },
  DDAY: { color: '#C15C00', bg: '#FFF3E0' },
  UPCOMING: { color: '#5B6270', bg: '#EEF0F2' },
  NEED_CONTRACT: { color: '#8A8F98', bg: '#EEF0F2' }
};
const BUCKET_ACCENT = { OVERDUE: '#E53935', DDAY: '#FB8C00', UPCOMING: '#B4B9C2', NEED_CONTRACT: '#B4B9C2' };
const BUCKET_SORT_ORDER = { OVERDUE: 0, DDAY: 1, NEED_CONTRACT: 2, UPCOMING: 3 };

// ---- date / format helpers ----

function fmtDate(s) {
  return s ? s.replace(/-/g, '.') : '';
}
function fmtAmount(n) {
  return '₩ ' + Number(n || 0).toLocaleString('ko-KR');
}
function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}
function addYearsMinus1Day(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return toISO(d);
}
function daysTo(end) {
  const e = new Date(end + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((e - today) / 86400000);
}
// Status is driven by 계약기간(종료일), not 사업기간:
//   계약기간 종료일이 없으면 '계약 필요', 지났으면 '만료',
//   30일 이내면 'D-남은일수', 그 외에는 '진행중'.
function statusOf(c) {
  if (!c.contractEnd) return { bucket: 'NEED_CONTRACT', label: '계약 필요' };
  const diff = daysTo(c.contractEnd);
  if (diff < 0) return { bucket: 'OVERDUE', label: '만료' };
  if (diff <= 30) return { bucket: 'DDAY', label: 'D-' + diff };
  return { bucket: 'UPCOMING', label: '진행중' };
}

function enrich(c) {
  const { bucket, label } = statusOf(c);
  const f = FACTORY_COLOR[c.factory];
  const s = STATUS_STYLE[bucket];
  const accentBar = BUCKET_ACCENT[bucket];
  return {
    id: c.id,
    vendor: c.vendor,
    factory: c.factory,
    factoryLabel: c.factory + '공장',
    factoryColor: f.color,
    factoryBg: f.bg,
    projectName: c.projectName,
    location: c.location,
    start: c.start,
    end: c.end,
    periodDisp: fmtDate(c.start) + ' ~ ' + fmtDate(c.end),
    amount: fmtAmount(c.amount),
    amountRaw: Number(c.amount) || 0,
    contractDate: c.contractDate,
    contractDateDisp: fmtDate(c.contractDate),
    contractStart: c.contractStart,
    contractEnd: c.contractEnd,
    contractPeriodDisp: fmtDate(c.contractStart) + ' ~ ' + fmtDate(c.contractEnd),
    bizNo: c.bizNo,
    dept: c.dept,
    manager: c.manager,
    deptDisp: c.dept + ' · ' + c.manager,
    email: c.email,
    bucket,
    bucketOrder: BUCKET_SORT_ORDER[bucket],
    statusLabel: label,
    statusColor: s.color,
    statusBg: s.bg,
    rowBg: bucket === 'OVERDUE' ? '#FDF2F2' : (bucket === 'DDAY' ? '#FFF8EE' : '#fff'),
    accentBar: (bucket === 'OVERDUE' || bucket === 'DDAY') ? accentBar : 'transparent'
  };
}

const SORT_ACCESSORS = {
  factory: r => r.factory,
  vendor: r => r.vendor,
  bizNo: r => r.bizNo,
  projectName: r => r.projectName,
  location: r => r.location,
  period: r => r.end,
  amount: r => r.amountRaw,
  contractDate: r => r.contractDate,
  contractPeriod: r => r.contractEnd,
  dept: r => r.dept,
  email: r => r.email,
  status: r => r.bucketOrder
};

function compareRowsBy(key, a, b) {
  const va = SORT_ACCESSORS[key](a);
  const vb = SORT_ACCESSORS[key](b);
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), 'ko');
}

function findRaw(id) {
  return state.contracts.find(c => c.id === id) || null;
}

// ---- toast ----

function showToast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  state.toast = msg;
  state.toastShow = true;
  render();
  toastTimer = setTimeout(() => { state.toastShow = false; render(); }, 2600);
}

// ---- mail modal ----

function openMail(contract) {
  const endDisp = contract.periodDisp.split(' ~ ')[1];
  const body = '안녕하세요, ' + contract.vendor + ' 담당자님.\n\n' +
    '울산 ' + contract.factory + '공장 「' + contract.projectName + '」 재해예방 기술지도 계약이 ' + endDisp + ' 만료 예정입니다.\n' +
    '계약 갱신을 위해 아래 서류 제출 및 일정 협의를 부탁드립니다.\n\n' +
    '  1. 계약서\n  2. 산재보험 가입증명원\n  3. 사업자등록증 사본\n\n' +
    '회신 기한: 만료일 7일 전까지\n감사합니다.\n\n울산 안전보건팀 드림';
  state.mailOpen = true;
  state.mailContract = contract;
  state.mailBody = body;
  render();
}
function closeMail() {
  state.mailOpen = false;
  render();
}
function openMailApp() {
  const c = state.mailContract;
  if (!c) return;
  const subject = '[울산 ' + c.factory + '공장] 재해예방 기술지도 계약 갱신 안내';
  window.location.href = 'mailto:' + c.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(state.mailBody);
  state.mailOpen = false;
  render();
  showToast('메일 프로그램을 실행합니다');
}

// ---- inline row editing (add / edit) + renew form ----

function startAddRow() {
  state.editingId = 'NEW';
  render();
}
function startEditRow(c) {
  state.editingId = c.id;
  render();
}
function cancelEditRow() {
  state.editingId = null;
  render();
}
function openRenewForm(c) {
  state.editingId = null;
  const newStart = addDays(c.end, 1);
  const newEnd = addYearsMinus1Day(newStart);
  // New contract period follows on from the old one (falling back to the
  // business period, then today, if no contract period was set yet).
  const contractBase = c.contractEnd || c.end || toISO(new Date());
  const newContractStart = addDays(contractBase, c.contractEnd || c.end ? 1 : 0);
  const newContractEnd = addYearsMinus1Day(newContractStart);
  state.formMode = 'renew';
  state.formContract = c;
  state.formValues = {
    factory: c.factory, vendor: c.vendor, bizNo: c.bizNo, projectName: c.projectName, location: c.location,
    start: newStart, end: newEnd, amount: c.amount,
    contractDate: toISO(new Date()), contractStart: newContractStart, contractEnd: newContractEnd,
    dept: c.dept, manager: c.manager, email: c.email
  };
  state.formOpen = true;
  render();
}
function closeForm() {
  state.formOpen = false;
  render();
}

// ---- bulk paste import (from Excel clipboard) ----

function openBulkModal() {
  state.bulkOpen = true;
  state.bulkRows = [];
  render();
}
function closeBulkModal() {
  state.bulkOpen = false;
  state.bulkRows = [];
  render();
}

function parseDateFlexible(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  // Excel serial date (cell copied without date formatting), Windows epoch 1899-12-30.
  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return toISO(new Date(epoch.getTime() + serial * 86400000));
    }
  }
  // yyyy-mm-dd / yyyy.mm.dd / yyyy/mm/dd / yyyy. m. d (Korean-style, with or without spaces)
  const m = s.match(/^(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})\.?$/);
  if (m) {
    const [, y, mo, d] = m;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  return null;
}

function parseAmountFlexible(raw) {
  const s = String(raw == null ? '' : raw).replace(/[^0-9.-]/g, '');
  if (s === '') return NaN;
  return Number(s);
}

function parseBulkRow(cols) {
  const errors = [];
  const factory = Number(String(cols[0] || '').replace(/[^0-9]/g, ''));
  if (![1, 2, 3].includes(factory)) errors.push('공장은 1/2/3만 가능');
  const vendor = String(cols[1] || '').trim();
  if (!vendor) errors.push('협력업체명 누락');
  const bizNo = String(cols[2] || '').trim();
  if (!bizNo) errors.push('사업자번호 누락');
  const projectName = String(cols[3] || '').trim();
  if (!projectName) errors.push('공사명 누락');
  const location = String(cols[4] || '').trim();
  if (!location) errors.push('소재지 누락');
  const start = parseDateFlexible(cols[5]);
  if (!start) errors.push('시작일 형식 오류');
  const end = parseDateFlexible(cols[6]);
  if (!end) errors.push('종료일 형식 오류');
  const amount = parseAmountFlexible(cols[7]);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('금액 오류');
  // 계약일자/계약기간은 비워둘 수 있음 (미입력 시 상태가 '계약 필요'로 표시됨).
  // 값이 있는데 형식을 못 알아본 경우만 오류로 처리한다.
  const contractDateRaw = String(cols[8] || '').trim();
  const contractDate = contractDateRaw ? parseDateFlexible(contractDateRaw) : null;
  if (contractDateRaw && !contractDate) errors.push('계약일자 형식 오류');
  const contractStartRaw = String(cols[9] || '').trim();
  const contractStart = contractStartRaw ? parseDateFlexible(contractStartRaw) : null;
  if (contractStartRaw && !contractStart) errors.push('계약기간(시작일) 형식 오류');
  const contractEndRaw = String(cols[10] || '').trim();
  const contractEnd = contractEndRaw ? parseDateFlexible(contractEndRaw) : null;
  if (contractEndRaw && !contractEnd) errors.push('계약기간(종료일) 형식 오류');
  const dept = String(cols[11] || '').trim();
  if (!dept) errors.push('담당부서 누락');
  const manager = String(cols[12] || '').trim();
  if (!manager) errors.push('담당자 누락');
  const email = String(cols[13] || '').trim();
  if (!email) errors.push('이메일 누락');
  return {
    values: {
      factory, vendor, bizNo, projectName, location, start, end, amount,
      contractDate, contractStart, contractEnd, dept, manager, email
    },
    errors
  };
}

function parseBulkText() {
  const textarea = document.getElementById('bulk-paste-textarea');
  const headerCheckbox = document.getElementById('bulk-header-checkbox');
  const text = textarea ? textarea.value : '';
  const skipHeader = headerCheckbox ? headerCheckbox.checked : true;
  let lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (skipHeader && lines.length > 0) lines = lines.slice(1);
  state.bulkRows = lines.map(line => {
    const cols = line.split('\t');
    const { values, errors } = parseBulkRow(cols);
    return { raw: line, values, errors };
  });
  render();
}

async function saveBulkRows() {
  const rows = state.bulkRows;
  if (rows.length === 0 || rows.some(r => r.errors.length > 0) || state.bulkSaving) return;
  state.bulkSaving = true;
  render();
  try {
    await Promise.all(rows.map(r =>
      addDoc(CONTRACTS_COL, { ...r.values, createdAt: serverTimestamp() })
    ));
    showToast(rows.length + '건이 일괄 등록되었습니다');
    state.bulkOpen = false;
    state.bulkRows = [];
    state.bulkSaving = false;
    render();
  } catch (err) {
    console.error(err);
    state.bulkSaving = false;
    showToast('일괄 저장 중 오류가 발생했습니다: ' + err.message);
    render();
  }
}

async function handleSubmit(e) {
  if (e.target.id === 'contract-form') return handleRenewSubmit(e);
  if (e.target.id === 'row-form') return handleInlineSubmit(e);
}

async function handleRenewSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const values = {
    factory: Number(fd.get('factory')),
    vendor: String(fd.get('vendor') || '').trim(),
    bizNo: String(fd.get('bizNo') || '').trim(),
    projectName: String(fd.get('projectName') || '').trim(),
    location: String(fd.get('location') || '').trim(),
    start: fd.get('start'),
    end: fd.get('end'),
    amount: Number(fd.get('amount')),
    contractDate: fd.get('contractDate'),
    contractStart: fd.get('contractStart'),
    contractEnd: fd.get('contractEnd'),
    dept: String(fd.get('dept') || '').trim(),
    manager: String(fd.get('manager') || '').trim(),
    email: String(fd.get('email') || '').trim()
  };

  const submitBtn = e.target.ownerDocument.querySelector('[form="contract-form"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const old = state.formContract;
    await addDoc(collection(db, 'contracts', old.id, 'history'), {
      start: old.start, end: old.end, amount: old.amount,
      dept: old.dept, manager: old.manager, archivedAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'contracts', old.id), values);
    showToast(values.vendor + ' 갱신 처리 완료');
    closeForm();
  } catch (err) {
    console.error(err);
    showToast('저장 중 오류가 발생했습니다: ' + err.message);
    render();
  }
}

async function handleInlineSubmit(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value;
  const values = {
    factory: Number(val('ef-factory')),
    vendor: val('ef-vendor').trim(),
    bizNo: val('ef-bizNo').trim(),
    projectName: val('ef-projectName').trim(),
    location: val('ef-location').trim(),
    start: val('ef-start'),
    end: val('ef-end'),
    amount: Number(val('ef-amount')),
    contractDate: val('ef-contractDate'),
    contractStart: val('ef-contractStart'),
    contractEnd: val('ef-contractEnd'),
    dept: val('ef-dept').trim(),
    manager: val('ef-manager').trim(),
    email: val('ef-email').trim()
  };

  const saveBtn = e.target.querySelector('.row-editing .btn-primary');
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (state.editingId === 'NEW') {
      await addDoc(CONTRACTS_COL, { ...values, createdAt: serverTimestamp() });
      showToast(values.vendor + ' 계약이 추가되었습니다');
    } else {
      await updateDoc(doc(db, 'contracts', state.editingId), values);
      showToast(values.vendor + ' 정보가 수정되었습니다');
    }
    state.editingId = null;
    render();
  } catch (err) {
    console.error(err);
    if (saveBtn) saveBtn.disabled = false;
    showToast('저장 중 오류가 발생했습니다: ' + err.message);
  }
}

async function handleDelete(c) {
  const ok = window.confirm(c.vendor + ' 계약을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.');
  if (!ok) return;
  try {
    const historySnap = await getDocs(collection(db, 'contracts', c.id, 'history'));
    await Promise.all(historySnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'contracts', c.id));
    showToast(c.vendor + ' 삭제됨');
  } catch (err) {
    console.error(err);
    showToast('삭제 중 오류가 발생했습니다: ' + err.message);
  }
}

// ---- 계약 이력 subscription ----

function subscribeHistory(contractId) {
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }
  state.historyEntries = [];
  if (!contractId) { render(); return; }
  state.historyLoading = true;
  const q = query(collection(db, 'contracts', contractId, 'history'), orderBy('archivedAt', 'desc'));
  unsubHistory = onSnapshot(q, snap => {
    state.historyEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.historyLoading = false;
    render();
  }, err => {
    console.error(err);
    state.historyLoading = false;
    render();
  });
}

// ---- render ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderTopbar(urgentCount) {
  const today = new Date();
  const todayDisp = today.getFullYear() + '년 ' + (today.getMonth() + 1) + '월 ' + today.getDate() + '일 (' + WEEKDAY[today.getDay()] + ')';
  return `
    <div class="topbar">
      <div class="topbar-left">
        <div class="logo-box"><div class="logo-diamond"></div></div>
        <div class="brand-text">
          <div class="brand-title">단가계약 기술지도 관리</div>
          <div class="brand-sub">울산 1·2·3공장</div>
        </div>
      </div>
      <div class="topbar-right">
        <div class="today-text">${todayDisp}</div>
        <div class="urgent-badge">만료임박 ${urgentCount}건</div>
        <button class="bell-btn" title="알림">
          <div class="bell-icon"></div>
          <div class="bell-dot"></div>
        </button>
      </div>
    </div>`;
}

function renderTabbar() {
  const items = TAB_DEFS.map(([key, label]) =>
    `<button class="tab-btn${state.tab === key ? ' active' : ''}" data-action="set-tab" data-tab="${key}">${label}</button>`
  ).join('');
  return `<div class="tabbar"><div class="tabbar-inner">${items}</div></div>`;
}

function sortIndicator(key) {
  if (state.sort.key !== key) return '';
  return state.sort.dir === 'asc' ? ' ▲' : ' ▼';
}
function thSort(key, label, extraStyle) {
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  return `<th class="th-sortable" data-action="sort-col" data-col="${key}"${style}>${label}${sortIndicator(key)}</th>`;
}

function renderTableView() {
  if (state.loading) {
    return `<div class="table-view"><div class="loading-state">데이터를 불러오는 중입니다...</div></div>`;
  }

  const factoryFilter = FACTORY_OF_TAB[state.tab];
  const q = state.search.trim();
  const all = state.contracts.map(enrich);
  let rows = all.filter(x =>
    (factoryFilter == null || x.factory === factoryFilter) &&
    (state.filter === 'all' || x.bucket === state.filter) &&
    (q === '' || x.vendor.includes(q) || x.projectName.includes(q))
  );
  if (state.sort.key) {
    const { key, dir } = state.sort;
    rows = rows.slice().sort((a, b) => {
      const c = compareRowsBy(key, a, b);
      return dir === 'asc' ? c : -c;
    });
  }
  rows = rows.map((x, i) => Object.assign({}, x, { idx: i + 1 }));

  const chips = CHIP_DEFS.map(([k, label]) => {
    const on = state.filter === k;
    return `<button class="chip${on ? ' active' : ''}" data-action="set-filter" data-filter="${k}">${label}</button>`;
  }).join('');

  const newRowHtml = state.editingId === 'NEW' ? renderEditRow(null) : '';
  const rowsHtml = rows.map(r => state.editingId === r.id ? renderEditRow(r) : renderRow(r)).join('');

  const emptyMsg = all.length === 0
    ? '등록된 계약이 없습니다. 우측 상단의 "+ 공사건 추가" 버튼으로 계약을 등록해 주세요.'
    : '조건에 맞는 계약이 없습니다.';

  return `
    <div class="table-view">
      <div class="table-header">
        <div class="table-title">${TABLE_TITLE[state.tab] || ''}</div>
        <div class="table-header-actions">
          <button class="btn-bulk" type="button" data-action="bulk-open">엑셀 붙여넣기 일괄등록</button>
          <button class="btn-add" type="button" data-action="add">+ 공사건 추가</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="search-input" class="search-input" placeholder="협력업체·공사명 검색" value="${esc(state.search)}" />
        <div class="chips">${chips}</div>
      </div>
      <div class="table-card">
        <form id="row-form">
          <table>
            <thead>
              <tr>
                <th>연번</th>
                ${thSort('factory', '공장')}
                ${thSort('vendor', '협력업체명', 'white-space:nowrap')}
                ${thSort('bizNo', '사업자번호')}
                ${thSort('projectName', '공사명')}
                ${thSort('location', '소재지')}
                ${thSort('period', '사업기간')}
                ${thSort('amount', '총공사금액')}
                ${thSort('contractDate', '계약일자')}
                ${thSort('contractPeriod', '계약기간')}
                ${thSort('dept', '담당')}
                ${thSort('email', '이메일')}
                ${thSort('status', '상태')}
                <th>액션</th>
              </tr>
            </thead>
            <tbody>${newRowHtml}${rowsHtml}</tbody>
          </table>
        </form>
        ${rows.length === 0 && !newRowHtml ? `<div class="no-rows">${emptyMsg}</div>` : ''}
      </div>
      <div class="table-footnote">만료 경과·만료임박 건은 좌측 컬러 바와 배경으로 강조됩니다.</div>
    </div>`;
}

function renderRow(r) {
  return `
      <tr style="background:${r.rowBg}">
        <td class="td-idx" style="border-left-color:${r.accentBar}">${r.idx}</td>
        <td><span class="factory-badge" style="color:${r.factoryColor};background:${r.factoryBg}">${r.factoryLabel}</span></td>
        <td class="td-vendor">${esc(r.vendor)}</td>
        <td class="td-bizno">${esc(r.bizNo)}</td>
        <td class="td-project">${esc(r.projectName)}</td>
        <td class="td-location">${esc(r.location)}</td>
        <td class="td-period">${esc(r.periodDisp)}</td>
        <td class="td-amount">${esc(r.amount)}</td>
        <td class="td-contract-date">${esc(r.contractDateDisp)}</td>
        <td class="td-period">${esc(r.contractPeriodDisp)}</td>
        <td class="td-dept">${esc(r.deptDisp)}</td>
        <td class="td-email">${esc(r.email)}</td>
        <td><span class="status-badge" style="color:${r.statusColor};background:${r.statusBg}">${r.statusLabel}</span></td>
        <td class="td-actions">
          <div class="action-row">
            <button class="btn-mail" type="button" data-action="mail" data-id="${r.id}">메일</button>
            <button class="btn-secondary" type="button" data-action="renew" data-id="${r.id}">갱신</button>
            <button class="btn-secondary" type="button" data-action="edit" data-id="${r.id}">수정</button>
            <button class="btn-danger" type="button" data-action="delete" data-id="${r.id}">삭제</button>
          </div>
        </td>
      </tr>`;
}

function renderEditRow(enrichedRow) {
  const raw = enrichedRow ? findRaw(enrichedRow.id) : null;
  const v = raw || { factory: FACTORY_OF_TAB[state.tab] || 1, vendor: '', bizNo: '', projectName: '', location: '', start: '', end: '', amount: '', contractDate: '', contractStart: '', contractEnd: '', dept: '', manager: '', email: '' };
  const idxLabel = enrichedRow ? enrichedRow.idx : '신규';
  const factoryOptions = [1, 2, 3].map(f =>
    `<option value="${f}"${v.factory === f ? ' selected' : ''}>${f}공장</option>`
  ).join('');

  return `
      <tr class="row-editing">
        <td class="td-idx">${idxLabel}</td>
        <td><select id="ef-factory">${factoryOptions}</select></td>
        <td><input id="ef-vendor" required value="${esc(v.vendor)}" placeholder="협력업체명"></td>
        <td><input id="ef-bizNo" required value="${esc(v.bizNo)}" placeholder="000-00-00000"></td>
        <td><input id="ef-projectName" required value="${esc(v.projectName)}" placeholder="공사명"></td>
        <td><input id="ef-location" required value="${esc(v.location)}" placeholder="공사장소재지"></td>
        <td class="td-period-edit">
          <input id="ef-start" type="date" required value="${esc(v.start)}">~<input id="ef-end" type="date" required value="${esc(v.end)}">
        </td>
        <td><input id="ef-amount" type="number" min="0" required value="${esc(v.amount)}"></td>
        <td><input id="ef-contractDate" type="date" value="${esc(v.contractDate)}"></td>
        <td class="td-period-edit">
          <input id="ef-contractStart" type="date" value="${esc(v.contractStart)}">~<input id="ef-contractEnd" type="date" value="${esc(v.contractEnd)}">
        </td>
        <td class="td-dept-edit">
          <input id="ef-dept" required value="${esc(v.dept)}" placeholder="담당부서">
          <input id="ef-manager" required value="${esc(v.manager)}" placeholder="담당자">
        </td>
        <td><input id="ef-email" type="email" required value="${esc(v.email)}" placeholder="이메일"></td>
        <td>-</td>
        <td class="td-actions">
          <div class="action-row">
            <button class="btn-primary" type="submit">저장</button>
            <button class="btn-cancel" type="button" data-action="cancel-row">취소</button>
          </div>
        </td>
      </tr>`;
}

function renderHistoryView() {
  if (state.loading) {
    return `<div class="history-view"><div class="loading-state">데이터를 불러오는 중입니다...</div></div>`;
  }
  if (state.contracts.length === 0) {
    return `<div class="history-view">
      <div class="history-title">계약 이력</div>
      <div class="history-desc">등록된 계약이 없습니다. 공사건을 먼저 추가해 주세요.</div>
    </div>`;
  }

  const chips = state.contracts.map(c => {
    const on = state.histContractId === c.id;
    return `<button class="history-chip${on ? ' active' : ''}" data-action="set-hist-contract" data-id="${c.id}">${esc(c.vendor)} (${c.factory}공장)</button>`;
  }).join('');

  const current = findRaw(state.histContractId);
  let nodesHtml = '';
  if (current) {
    if (state.historyLoading) {
      nodesHtml = `<div class="loading-state">이력을 불러오는 중입니다...</div>`;
    } else {
      const entries = [
        { start: current.start, end: current.end, amount: current.amount, dept: current.dept, manager: current.manager },
        ...state.historyEntries
      ];
      const total = entries.length;
      nodesHtml = entries.map((n, i) => {
        const renewalNumber = total - 1 - i;
        const label = (renewalNumber === 0 ? '최초 계약' : renewalNumber + '차 갱신') + (i === 0 ? ' (현재)' : '');
        const isCurrent = i === 0;
        const statusText = isCurrent ? '진행중' : '완료';
        const statusColor = isCurrent ? '#1F8A5B' : '#8A8F98';
        const statusBg = isCurrent ? '#E7F4EE' : '#EEF0F2';
        const dotColor = isCurrent ? '#43A047' : '#B4B9C2';
        const dotRing = isCurrent ? '#CDEBD9' : '#E5E7EB';
        return `
          <div class="timeline-node">
            <div class="timeline-dot-col">
              <span class="timeline-dot" style="background:${dotColor};border-color:${dotRing}"></span>
              <span class="timeline-line"></span>
            </div>
            <div class="timeline-card">
              <div class="timeline-head">
                <div class="timeline-head-left">
                  <span class="timeline-label">${esc(label)}</span>
                  <span class="timeline-status" style="color:${statusColor};background:${statusBg}">${statusText}</span>
                </div>
                <span class="timeline-amount">${esc(fmtAmount(n.amount))}</span>
              </div>
              <div class="timeline-period">계약기간 ${esc(fmtDate(n.start))} ~ ${esc(fmtDate(n.end))}</div>
              <div class="timeline-dept">담당 ${esc(n.dept)} · ${esc(n.manager)}</div>
            </div>
          </div>`;
      }).join('');
    }
  }

  return `
    <div class="history-view">
      <div class="history-title">계약 이력</div>
      <div class="history-desc">업체를 선택하면 최초 계약부터 현재까지의 갱신 계보를 최신순으로 확인할 수 있습니다.</div>
      <div class="history-vendors">${chips}</div>
      <div>${nodesHtml}</div>
    </div>`;
}

function renderMailModal() {
  if (!state.mailOpen) return '';
  const c = state.mailContract;
  return `
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <div class="modal-title">갱신 안내 메일</div>
            <div class="modal-subtitle">받는사람 · ${esc(c ? c.email : '')}</div>
          </div>
          <button class="modal-close" data-action="close-mail">✕</button>
        </div>
        <div class="modal-body">
          <textarea id="mail-textarea" class="modal-textarea">${esc(state.mailBody)}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" data-action="close-mail">취소</button>
          <button class="btn-primary" data-action="open-mail-app">메일 프로그램 열기</button>
        </div>
      </div>
    </div>`;
}

const FORM_TITLE = { renew: '계약 갱신' };
const FORM_SUBMIT_LABEL = { renew: '갱신 저장' };

function renderFormModal() {
  if (!state.formOpen) return '';
  const v = state.formValues;
  const factoryOptions = [1, 2, 3].map(f =>
    `<option value="${f}"${v.factory === f ? ' selected' : ''}>${f}공장</option>`
  ).join('');

  return `
    <div class="modal-overlay">
      <div class="modal-card form-card">
        <div class="modal-header">
          <div class="modal-title">${FORM_TITLE[state.formMode]} · ${esc(v.vendor)}</div>
          <button class="modal-close" data-action="close-form">✕</button>
        </div>
        <form id="contract-form" class="form-body">
          <div class="form-grid">
            <label class="form-field"><span>공장</span><select name="factory">${factoryOptions}</select></label>
            <label class="form-field"><span>협력업체명</span><input name="vendor" required value="${esc(v.vendor)}"></label>
            <label class="form-field"><span>사업자등록번호</span><input name="bizNo" required value="${esc(v.bizNo)}" placeholder="000-00-00000"></label>
            <label class="form-field"><span>공사장소재지</span><input name="location" required value="${esc(v.location)}"></label>
            <label class="form-field form-field-wide"><span>공사명</span><input name="projectName" required value="${esc(v.projectName)}"></label>
            <label class="form-field"><span>사업 시작일</span><input type="date" name="start" required value="${esc(v.start)}"></label>
            <label class="form-field"><span>사업 종료일</span><input type="date" name="end" required value="${esc(v.end)}"></label>
            <label class="form-field"><span>총공사금액 (원)</span><input type="number" name="amount" min="0" required value="${esc(v.amount)}"></label>
            <label class="form-field"><span>계약일자</span><input type="date" name="contractDate" value="${esc(v.contractDate)}"></label>
            <label class="form-field"><span>계약기간(시작일)</span><input type="date" name="contractStart" value="${esc(v.contractStart)}"></label>
            <label class="form-field"><span>계약기간(종료일)</span><input type="date" name="contractEnd" value="${esc(v.contractEnd)}"></label>
            <label class="form-field"><span>공사담당부서</span><input name="dept" required value="${esc(v.dept)}"></label>
            <label class="form-field"><span>공사담당자</span><input name="manager" required value="${esc(v.manager)}"></label>
            <label class="form-field"><span>담당자 이메일</span><input type="email" name="email" required value="${esc(v.email)}"></label>
          </div>
        </form>
        <div class="modal-footer">
          <button class="btn-cancel" type="button" data-action="close-form">취소</button>
          <button class="btn-primary" type="submit" form="contract-form">${FORM_SUBMIT_LABEL[state.formMode]}</button>
        </div>
      </div>
    </div>`;
}

function renderBulkModal() {
  if (!state.bulkOpen) return '';
  const rows = state.bulkRows;
  const errorCount = rows.filter(r => r.errors.length > 0).length;
  const okCount = rows.length - errorCount;
  const canSave = rows.length > 0 && errorCount === 0 && !state.bulkSaving;

  const previewRows = rows.map((r, i) => {
    const v = r.values;
    const hasErr = r.errors.length > 0;
    return `
      <tr style="background:${hasErr ? '#FDECEC' : '#fff'}">
        <td>${i + 1}</td>
        <td>${v.factory || ''}</td>
        <td>${esc(v.vendor)}</td>
        <td>${esc(v.bizNo)}</td>
        <td>${esc(v.projectName)}</td>
        <td>${esc(v.location)}</td>
        <td>${esc(v.start || '')}</td>
        <td>${esc(v.end || '')}</td>
        <td>${Number.isFinite(v.amount) ? v.amount.toLocaleString('ko-KR') : ''}</td>
        <td>${esc(v.contractDate || '')}</td>
        <td>${esc(v.contractStart || '')}</td>
        <td>${esc(v.contractEnd || '')}</td>
        <td>${esc(v.dept)}</td>
        <td>${esc(v.manager)}</td>
        <td>${esc(v.email)}</td>
        <td style="color:#E53935">${hasErr ? esc(r.errors.join(', ')) : 'OK'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="modal-overlay">
      <div class="modal-card bulk-card">
        <div class="modal-header">
          <div>
            <div class="modal-title">엑셀 붙여넣기로 일괄 등록</div>
            <div class="modal-subtitle">엑셀에서 범위를 복사(Ctrl+C)한 뒤 아래에 붙여넣으세요(Ctrl+V). 열 순서: 공장(1/2/3) · 협력업체명 · 사업자번호 · 공사명 · 소재지 · 사업 시작일 · 사업 종료일 · 총공사금액 · 계약일자 · 계약기간(시작일) · 계약기간(종료일) · 담당부서 · 담당자 · 이메일 (계약일자/계약기간은 비워둘 수 있으며, 비워두면 상태가 '계약 필요'로 표시됩니다)</div>
          </div>
          <button class="modal-close" type="button" data-action="bulk-close">✕</button>
        </div>
        <div class="modal-body">
          <textarea id="bulk-paste-textarea" class="modal-textarea bulk-textarea" placeholder="엑셀에서 복사한 내용을 여기에 붙여넣으세요"></textarea>
          <label class="bulk-header-check">
            <input type="checkbox" id="bulk-header-checkbox" checked> 첫 행은 머릿글입니다 (건너뛰기)
          </label>
          <button class="btn-secondary" type="button" data-action="bulk-parse">미리보기 파싱</button>
          ${rows.length > 0 ? `
            <div class="bulk-summary">총 ${rows.length}행 · 정상 ${okCount}행 · 오류 ${errorCount}행</div>
            <div class="bulk-preview-wrap">
              <table class="bulk-preview-table">
                <thead><tr>
                  <th>#</th><th>공장</th><th>업체명</th><th>사업자번호</th><th>공사명</th><th>소재지</th>
                  <th>시작일</th><th>종료일</th><th>금액</th><th>계약일자</th><th>계약(시작)</th><th>계약(종료)</th>
                  <th>부서</th><th>담당자</th><th>이메일</th><th>확인</th>
                </tr></thead>
                <tbody>${previewRows}</tbody>
              </table>
            </div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" type="button" data-action="bulk-close">취소</button>
          <button class="btn-primary" type="button" data-action="bulk-save"${canSave ? '' : ' disabled'}>${state.bulkSaving ? '저장 중...' : `일괄 저장 (${okCount}건)`}</button>
        </div>
      </div>
    </div>`;
}

function renderToast() {
  if (!state.toastShow) return '';
  return `<div class="toast">${esc(state.toast)}</div>`;
}

function renderApp() {
  const all = state.contracts.map(enrich);
  const urgentCount = all.filter(x => x.bucket === 'OVERDUE' || x.bucket === 'DDAY').length;
  const main = state.tab === 'history' ? renderHistoryView() : renderTableView();
  return `
    ${renderTopbar(urgentCount)}
    ${renderTabbar()}
    <div class="content">${main}</div>
    ${renderMailModal()}
    ${renderFormModal()}
    ${renderBulkModal()}
    ${renderToast()}
  `;
}

function render() {
  const active = document.activeElement;
  let focusId = null, selStart = null, selEnd = null;
  if (active && (active.id === 'search-input' || active.id === 'mail-textarea')) {
    focusId = active.id;
    selStart = active.selectionStart;
    selEnd = active.selectionEnd;
  }
  document.getElementById('app').innerHTML = renderApp();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typeof selStart === 'number') el.setSelectionRange(selStart, selEnd);
    }
  }
}

// ---- events ----

function handleClick(e) {
  if (e.target.classList.contains('modal-overlay')) {
    if (state.mailOpen) closeMail();
    if (state.formOpen) closeForm();
    if (state.bulkOpen) closeBulkModal();
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  switch (action) {
    case 'set-tab':
      state.tab = btn.dataset.tab;
      state.editingId = null;
      if (state.tab === 'history') {
        if (!state.histContractId || !state.contracts.some(c => c.id === state.histContractId)) {
          state.histContractId = state.contracts[0] ? state.contracts[0].id : null;
        }
        subscribeHistory(state.histContractId);
      }
      render();
      break;
    case 'set-filter':
      state.filter = btn.dataset.filter;
      render();
      break;
    case 'set-hist-contract':
      state.histContractId = btn.dataset.id;
      subscribeHistory(state.histContractId);
      render();
      break;
    case 'add':
      startAddRow();
      break;
    case 'mail': {
      const row = findRaw(btn.dataset.id);
      if (row) openMail(enrich(row));
      break;
    }
    case 'renew': {
      const row = findRaw(btn.dataset.id);
      if (row) openRenewForm(row);
      break;
    }
    case 'edit': {
      const row = findRaw(btn.dataset.id);
      if (row) startEditRow(row);
      break;
    }
    case 'delete': {
      const row = findRaw(btn.dataset.id);
      if (row) handleDelete(row);
      break;
    }
    case 'cancel-row':
      cancelEditRow();
      break;
    case 'bulk-open':
      openBulkModal();
      break;
    case 'bulk-close':
      closeBulkModal();
      break;
    case 'bulk-parse':
      parseBulkText();
      break;
    case 'bulk-save':
      saveBulkRows();
      break;
    case 'sort-col': {
      const col = btn.dataset.col;
      if (state.sort.key !== col) {
        state.sort = { key: col, dir: 'asc' };
      } else if (state.sort.dir === 'asc') {
        state.sort = { key: col, dir: 'desc' };
      } else {
        state.sort = { key: null, dir: null };
      }
      render();
      break;
    }
    case 'close-mail':
      closeMail();
      break;
    case 'open-mail-app':
      openMailApp();
      break;
    case 'close-form':
      closeForm();
      break;
  }
}

let composing = false;

function handleInput(e) {
  if (e.target.id === 'search-input') {
    state.search = e.target.value;
    // Re-rendering rebuilds the input element, which aborts an in-progress
    // Korean/Japanese/Chinese IME composition and splits jamo apart. Defer
    // the render until composition ends (see handleCompositionEnd below).
    if (composing) return;
    render();
  } else if (e.target.id === 'mail-textarea') {
    // No re-render needed: nothing else derives from mailBody until send.
    state.mailBody = e.target.value;
  }
}

function handleCompositionStart() {
  composing = true;
}
function handleCompositionEnd(e) {
  composing = false;
  if (e.target.id === 'search-input') {
    state.search = e.target.value;
    render();
  }
}

const appEl = document.getElementById('app');
appEl.addEventListener('click', handleClick);
appEl.addEventListener('input', handleInput);
appEl.addEventListener('submit', handleSubmit);
appEl.addEventListener('compositionstart', handleCompositionStart);
appEl.addEventListener('compositionend', handleCompositionEnd);

render();

onSnapshot(CONTRACTS_COL, snap => {
  state.contracts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.loading = false;
  if (state.tab === 'history') {
    const stillExists = state.contracts.some(c => c.id === state.histContractId);
    if (!stillExists) {
      const newId = state.contracts[0] ? state.contracts[0].id : null;
      if (newId !== state.histContractId) {
        state.histContractId = newId;
        subscribeHistory(newId);
        return; // subscribeHistory triggers its own render
      }
    }
  }
  render();
}, err => {
  console.error(err);
  state.loading = false;
  showToast('데이터를 불러오지 못했습니다: ' + err.message);
});
