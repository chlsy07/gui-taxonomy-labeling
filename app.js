/* GUI Memory Taxonomy — labeling console.
 *
 * Work assignment is coverage-first: the client reads the aggregate per-item
 * label counts from Supabase and serves whichever items are still short of
 * their target, so several labelers can run in parallel without coordination.
 * Nobody can read anyone else's label — only the counts are readable — so a
 * stratum-B item stays a blind judgement no matter how many people work on it.
 */
'use strict';

const CFG = window.LABELING_CONFIG || {};
// Tolerate a project URL pasted with the /rest/v1 path already on it.
const REST = CFG.supabaseUrl
  ? CFG.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + '/rest/v1'
  : null;
const ONLINE = Boolean(REST && CFG.supabaseAnonKey);

const LS = {
  id: 'gtx.labeler_id',
  done: 'gtx.done',
  queue: 'gtx.pending',
  all: 'gtx.all',
};

/* How often to re-sync the "who has already labeled what" counts, in submits. */
const REFRESH_EVERY = 15;

const TASK_HINTS = {
  ACCESS: '메뉴·페이지·패널·설정을 열어 접근',
  AUTHOR: '텍스트·문서·콘텐츠를 만들거나 편집',
  CONFIGURE: '옵션·설정값·폼 값을 변경',
  EXECUTE: '실행·저장·전송·확정 등 명령 발사',
  INSPECT: '내용을 보려고 열기·선택·펼치기',
  LOCATE: '검색·필터·이동·스크롤로 대상 찾기',
  ORGANIZE: '이동·정렬·선택으로 구조 바꾸기',
  REFINE: '색·서식·크기 등 외형만 조정',
};

const ACTION_HINTS = {
  click: '한 번 클릭',
  double_click: '더블 클릭',
  right_click: '오른쪽 클릭',
  drag: '누른 채로 끌기',
  scroll: '휠·트랙패드 스크롤',
  type: '글자·값 입력 (붙여넣기 포함)',
  press_enter: 'Enter로 확정·검색·제출',
  hotkey: '단축키 조합 (Ctrl+C 등)',
  terminate: '에피소드 종료 — GUI 조작 아님',
  wait: 'UI를 기다림 — 입력 없음',
};

/* Ordered decision ladder for DOMAIN. The 12 labels overlap when read as
 * independent descriptions, so the labeler needs the priority order, not just
 * the list. Mirrors the ladder in taxonomy/TAXONOMY.md. */
const DOMAIN_LADDER = `
<ol class="ladder">
  <li><b>인증 표면</b>이면 Security</li>
  <li><b>OS 소유 표면</b>이면 System</li>
  <li><b>브라우저 자체·범용 검색엔진·지도</b>면 Search/Browser/Maps</li>
  <li>그 외에는 <b>현재 페이지·앱의 주 기능</b>으로 분류</li>
  <li>기능 도구가 아닌 <b>읽기 중심 일반 정보 페이지</b>만 General Web/App</li>
</ol>
<p class="ladder-note">
  위에서 <b>처음 맞는 규칙 하나만</b> 적용합니다. Scholar·arXiv·위키백과 내부 검색은
  Research이고, Amazon 내부 검색은 Commerce입니다. 검색 동작 자체는 TASK의 LOCATE가 기록합니다.
</p>`;

const DOMAIN_HINTS = {
  'Security, Accounts & Credentials': '1순위 · 로그인·비밀번호·인증·계정 보안·권한 동의 화면',
  'System, Files & OS Settings': '2순위 · OS 설정·탐색기·바탕화면·OS 파일 열기/저장 창',
  'Search, Browser & Maps': '3순위 · 브라우저 주소창/탭/설정, 범용 검색엔진 결과, 지도만',
  'Documents & Productivity': '문서·표·슬라이드·메모·PDF·할 일·드라이브 작업 화면',
  'Communication, Social & Scheduling': '메일·채팅·회의·캘린더·SNS·연락처 화면',
  'Commerce, Travel & Services': '상품·예약·여행·배달·채용·결제·고객 서비스 화면',
  'Media, Entertainment & Gaming': '영상·음악 소비·스트리밍 탐색·게임 화면 (편집 제외)',
  'Developer, Cloud & Data': '코드·터미널·저장소·클라우드 콘솔·분석·노트북 화면',
  'Research, Education & Reference': '학술·강의·학교·백과·참고자료 전용 화면 (범용 검색 제외)',
  'AI Assistants & Generation': 'AI 대화·프롬프트·생성 결과를 다루는 화면',
  'Creative & Media Editing': '이미지·영상·음성·디자인을 직접 제작·편집하는 화면',
  'General Web/App': '뉴스·블로그·회사 소개 등 위 기능 도구가 아닌 읽기 중심 정보 화면',
};

const DOMAIN_ORDER = [
  'Security, Accounts & Credentials',
  'System, Files & OS Settings',
  'Search, Browser & Maps',
  'Documents & Productivity',
  'Communication, Social & Scheduling',
  'Commerce, Travel & Services',
  'Media, Entertainment & Gaming',
  'Developer, Cloud & Data',
  'Research, Education & Reference',
  'AI Assistants & Generation',
  'Creative & Media Editing',
  'General Web/App',
];

const FORM_GROUPS = [
  ['버튼 / 명령', ['command_button', 'icon_button', 'toolbar_button']],
  ['메뉴', ['top_level_menu_opener', 'app_menu_button', 'submenu_opener', 'menu_opener',
            'menu_item', 'menu_item:on', 'menu_item:off']],
  ['드롭다운 / 목록', ['closed_dropdown_field', 'open_dropdown_item', 'list_item']],
  ['입력', ['text_input_field', 'numeric_input_field', 'search_box']],
  ['상태 선택', ['checkbox_option', 'checkbox_option:on', 'checkbox_option:off',
                'radio_option', 'radio_option:on', 'radio_option:off',
                'toggle_option', 'toggle_option:on', 'toggle_option:off']],
  ['셀 / 문서 영역', ['cell', 'header_cell', 'document_text', 'visual_region']],
  ['내비게이션 / 시각 항목', ['navigation_entry', 'tab', 'link', 'thumbnail_item']],
  ['직접 조작', ['slider_handle', 'scrollbar_thumb', 'spinner_button:up', 'spinner_button:down']],
  ['다이얼로그 폴백', ['dialog_option']],
];

const FORM_HINTS = {
  command_button: '텍스트(+아이콘) 버튼, 명령을 바로 실행',
  icon_button: '아이콘만 있는 독립 버튼',
  toolbar_button: '툴바·리본 안의 버튼',
  top_level_menu_opener: '상단 메뉴바의 File/Edit/View 같은 항목',
  app_menu_button: '앱·브라우저 전역 메뉴(햄버거·점 3개)',
  submenu_opener: '이미 열린 메뉴 안에서 하위 메뉴를 여는 항목',
  menu_opener: '행 케밥 등 지역·컨텍스트 메뉴 열기',
  menu_item: '열린 메뉴 안의 명령 항목',
  'menu_item:on': '체크된 상태의 메뉴 항목',
  'menu_item:off': '체크 해제 상태의 메뉴 항목',
  closed_dropdown_field: '닫힌 드롭다운/콤보 필드 또는 그 캐럿',
  open_dropdown_item: '이미 열린 드롭다운 팝업 안의 선택지',
  list_item: '상시 표시되는 목록·테이블·리스트박스 항목',
  text_input_field: '일반 텍스트 입력 필드·본문 편집 영역',
  numeric_input_field: '값이 주로 숫자인 필드',
  search_box: '검색 필드',
  checkbox_option: '체크박스 (상태 불명·무관)',
  'checkbox_option:on': '현재 체크된 체크박스',
  'checkbox_option:off': '현재 해제된 체크박스',
  radio_option: '라디오 (상태 불명·무관)',
  'radio_option:on': '현재 선택된 라디오',
  'radio_option:off': '현재 미선택 라디오',
  toggle_option: '토글/스위치 (상태 불명·무관)',
  'toggle_option:on': '현재 켜진 토글',
  'toggle_option:off': '현재 꺼진 토글',
  cell: '스프레드시트·표·달력·그리드 셀',
  header_cell: '정렬·행열 선택 같은 헤더 전용 동작 셀',
  document_text: '문서·편집 영역의 기존 텍스트',
  visual_region: '캔버스·이미지·빈 영역 등 개별 컨트롤이 아닌 곳',
  navigation_entry: '사이드바·내비 트리 항목',
  tab: '탭 스트립의 탭',
  link: '하이퍼링크',
  thumbnail_item: '템플릿·이미지·슬라이드 등 썸네일 카드',
  slider_handle: '슬라이더 손잡이',
  scrollbar_thumb: '스크롤바 썸',
  'spinner_button:up': '증가 스피너 화살표',
  'spinner_button:down': '감소 스피너 화살표',
  dialog_option: '다른 형태에 안 맞는 다이얼로그 전용 옵션',
};

const RULES_HTML = `
<div class="rules">
  <h4>가장 중요한 원칙</h4>
  <ul>
    <li>텍스트만 보고 라벨하지 마세요. <b>스크린샷을 반드시 확인</b>합니다. 텍스트와 화면이 어긋나면 <b>화면·액션 타깃이 이깁니다</b>.</li>
    <li>빨간 원은 실제 클릭 좌표입니다. 그 지점의 컨트롤을 라벨합니다. 주변 행 전체가 아니라 <b>찍힌 대상</b>입니다.</li>
    <li>TARGET FORM에 보이는 <b>글자나 아이콘 이름을 넣지 않습니다</b>. <code>Save</code>, <code>gear</code>, <code>kebab</code>는 라벨이 아니라 근거입니다.</li>
  </ul>
  <h4>자주 틀리는 구분</h4>
  <ul>
    <li>닫힌 드롭다운/캐럿 = <code>closed_dropdown_field</code>, 이미 열린 목록의 선택지 = <code>open_dropdown_item</code>.</li>
    <li>상단 메뉴바 File/Edit/View = <code>top_level_menu_opener</code>, 열린 메뉴 안의 하위 메뉴 = <code>submenu_opener</code>, 열린 메뉴 안의 명령 = <code>menu_item</code>.</li>
    <li><code>:on</code>/<code>:off</code>는 <b>현재 상태가 클릭 효과를 바꿀 때만</b> 씁니다. 보이지 않으면 접미사 없는 기본 라벨.</li>
    <li>스피너 화살표만 <code>spinner_button:up/down</code>입니다. 드롭다운 캐럿은 스피너가 아닙니다.</li>
    <li>본문·댓글·에디터에 입력하면 <code>text_input_field</code>, 기존 텍스트를 대상으로 잡으면 <code>document_text</code>.</li>
  </ul>
  <h4>축별 주의</h4>
  <ul>
    <li><b>TASK</b>는 전체 과제가 아니라 <b>이번 한 액션</b>의 효과입니다.</li>
    <li><b>ACTION</b>은 원본 코드의 모터 동작 그대로입니다. 입력이면 의도가 무엇이든 <code>type</code>.</li>
    <li><b>DOMAIN</b>은 브랜드가 아니라 <b>화면의 기능</b>으로 정합니다. OS 파일 열기/저장 창은 앱이 무엇이든 <code>System, Files &amp; OS Settings</code>, 로그인·비밀번호·권한 동의 화면은 <code>Security, Accounts &amp; Credentials</code>.</li>
  </ul>
</div>`;

/* ── State ─────────────────────────────────────────────────────── */
const S = {
  items: [],
  vocab: null,
  byId: new Map(),
  queue: [],
  cursor: 0,
  current: null,
  pick: { task: null, target_form: null, action: null, domain: null },
  startedAt: 0,
  done: new Set(),
  pending: [],
  zoom: 1,
  showMarker: true,
  showLoupe: true,
  submittedThisSession: 0,
  counts: new Map(),
  countsKnown: false,
  finalGoal: { agentnetbench_items: 0, agentnet_items: 0 },
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function labelerId() {
  let id = localStorage.getItem(LS.id);
  if (!id) {
    id = 'lb_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2).padEnd(24, '0')).slice(0, 24);
    localStorage.setItem(LS.id, id);
  }
  return id;
}

/* Stable per-labeler ordering so two people starting at once diverge instead of colliding. */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ── Boot ──────────────────────────────────────────────────────── */
async function boot() {
  $('#gate-rules').innerHTML = RULES_HTML;
  $('#help-rules').innerHTML = RULES_HTML;
  S.done = new Set(loadJSON(LS.done, []));
  S.pending = loadJSON(LS.queue, []);

  const status = $('#gate-status');
  try {
    const res = await fetch('data/items.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('items.json ' + res.status);
    const payload = await res.json();
    S.items = payload.items;
    S.vocab = payload.vocab;
    S.finalGoal = payload.final_goal || S.finalGoal;
    S.items.forEach((it) => S.byId.set(it.item_id, it));
    const counts = await fetchCounts();
    status.textContent = ONLINE && S.countsKnown
      ? `${S.items.length}개 이미지 준비됨 · 전체 ${globalProgressSummary(counts)}`
      : `${S.items.length}개 이미지 준비됨 · 서버 미연결: 제출은 브라우저에 보관됩니다`;
    status.classList.remove('err');
    $('#gate-start').disabled = false;
  } catch (err) {
    status.textContent = '데이터를 불러오지 못했습니다: ' + err.message;
    status.classList.add('err');
  }

  $('#gate-start').addEventListener('click', start);
}

async function start() {
  $('#gate-start').disabled = true;
  $('#gate-status').textContent = '작업 목록을 가져오는 중…';

  const counts = S.countsKnown ? S.counts : await fetchCounts();
  buildQueue(counts);

  $('#gate').hidden = true;
  $('#app').hidden = false;
  buildOptions();
  wireUI();
  flushPending();
  render();
}

async function fetchCounts() {
  if (!ONLINE) { updateGlobalProgress(null); return new Map(); }
  try {
    const res = await fetch(`${REST}/label_counts?select=item_id,n`, { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const counts = new Map(rows.map((r) => [r.item_id, r.n]));
    S.counts = counts;
    S.countsKnown = true;
    updateGlobalProgress(counts);
    setSync('ok', '서버 연결됨');
    return counts;
  } catch (err) {
    updateGlobalProgress(null);
    setSync('off', '오프라인 (로컬 저장)');
    console.warn('label_counts fetch failed', err);
    return new Map();
  }
}

function authHeaders(extra) {
  return Object.assign({
    apikey: CFG.supabaseAnonKey,
    Authorization: 'Bearer ' + CFG.supabaseAnonKey,
    'Content-Type': 'application/json',
  }, extra || {});
}

/* Coverage-first: fewest existing labels first, then a labeler-specific shuffle. */
function buildQueue(counts) {
  const id = labelerId();
  const open = S.items.filter((it) => {
    if (S.done.has(it.item_id)) return false;
    return (counts.get(it.item_id) || 0) < (it.labels_wanted || 1);
  });
  open.sort((a, b) => {
    // Encoder benchmark queries and the memories retrieved for those queries
    // are the first tranche. No general audit item is served while one of
    // these still needs a human label.
    const pa = a.priority_group ? 0 : (a.dataset === 'agentnetbench_test' ? 1 : 2);
    const pb = b.priority_group ? 0 : (b.dataset === 'agentnetbench_test' ? 1 : 2);
    if (pa !== pb) return pa - pb;
    const na = counts.get(a.item_id) || 0;
    const nb = counts.get(b.item_id) || 0;
    if (na !== nb) return na - nb;
    if (pa === 0 && a.priority_rank !== b.priority_rank) {
      return (a.priority_rank || 0) - (b.priority_rank || 0);
    }
    return hash32(id + a.item_id) - hash32(id + b.item_id);
  });
  S.queue = open;
  S.cursor = 0;
}

/* ── Option rendering ──────────────────────────────────────────── */
function buildOptions() {
  const taskBox = $('#opts-task');
  S.vocab.task.forEach((value, i) => {
    const node = el('button', 'opt opt-explained');
    node.type = 'button';
    node.dataset.value = value;
    const label = el('span', 'opt-label', value);
    label.append(el('span', 'k', String(i + 1)));
    node.append(label, el('span', 'opt-desc', TASK_HINTS[value] || ''));
    node.addEventListener('click', () => pick('task', value));
    taskBox.append(node);
  });

  const actionBox = $('#opts-action');
  S.vocab.action.forEach((value) => {
    const node = el('button', 'opt');
    node.type = 'button';
    node.dataset.value = value;
    node.textContent = value;
    node.addEventListener('click', () => pick('action', value));
    actionBox.append(node);
  });

  const formBox = $('#opts-target_form');
  const known = new Set(S.vocab.target_form);
  FORM_GROUPS.forEach(([title, values]) => {
    const present = values.filter((v) => known.has(v));
    if (!present.length) return;
    formBox.append(el('div', 'group-title', title));
    const row = el('div', 'group-opts');
    present.forEach((value) => {
      const node = el('button', 'opt');
      node.type = 'button';
      node.dataset.value = value;
      node.dataset.search = (value + ' ' + (FORM_HINTS[value] || '')).toLowerCase();
      node.textContent = value;
      node.title = FORM_HINTS[value] || '';
      node.addEventListener('click', () => pick('target_form', value));
      row.append(node);
    });
    formBox.append(row);
  });

  $('#domain-ladder').innerHTML = DOMAIN_LADDER;
  const domainBox = $('#opts-domain');
  const domainValues = DOMAIN_ORDER.filter((value) => S.vocab.domain.includes(value));
  S.vocab.domain.forEach((value) => {
    if (!domainValues.includes(value)) domainValues.push(value);
  });
  domainValues.forEach((value) => {
    const node = el('button', 'opt opt-explained domain-opt');
    node.type = 'button';
    node.dataset.value = value;
    node.append(el('span', 'opt-label', value), el('span', 'opt-desc', DOMAIN_HINTS[value] || ''));
    node.addEventListener('click', () => pick('domain', value));
    domainBox.append(node);
  });
}

function configureAction(item) {
  const auto = item.action_auto;
  const axis = document.querySelector('.axis[data-axis="action"]');
  const autoBox = $('#action-auto');
  const optionBox = $('#opts-action');
  if (auto && S.vocab.action.includes(auto)) {
    S.pick.action = auto;
    autoBox.innerHTML = '';
    autoBox.append(
      el('span', 'auto-mark', '자동'),
      el('code', null, auto),
      el('span', 'auto-desc', ACTION_HINTS[auto] || '원본 코드에서 판정')
    );
    autoBox.hidden = false;
    optionBox.hidden = true;
    axis.classList.remove('missing');
    axis.classList.add('auto-filled');
    return;
  }

  // Defensive fallback for old/stale items.json files. Fresh pools derive all
  // supported ACTION values, but keeping this visible is safer than submitting
  // a null value if a new primitive is introduced later.
  autoBox.hidden = true;
  optionBox.hidden = false;
  axis.classList.remove('auto-filled');
}

function pick(axis, value) {
  S.pick[axis] = S.pick[axis] === value ? null : value;
  document.querySelectorAll(`#opts-${axis} .opt`).forEach((node) => {
    node.classList.toggle('sel', node.dataset.value === S.pick[axis]);
  });
  document.querySelector(`.axis[data-axis="${axis}"]`).classList.toggle('missing', !S.pick[axis]);
  $('#btn-submit').disabled = !complete();
}

const complete = () => ['task', 'target_form', 'action', 'domain'].every((a) => S.pick[a]);

/* ── Rendering one item ────────────────────────────────────────── */
function render() {
  if (S.cursor >= S.queue.length) return renderDone();
  const item = S.queue[S.cursor];
  S.current = item;
  S.startedAt = Date.now();
  S.pick = { task: null, target_form: null, action: null, domain: null };

  document.querySelectorAll('.opt.sel').forEach((n) => n.classList.remove('sel'));
  document.querySelectorAll('.axis').forEach((n) => n.classList.add('missing'));
  $('#btn-submit').disabled = true;
  $('#unsure').checked = false;
  $('#notes').value = '';
  $('#search-target_form').value = '';
  filterForms('');

  $('#chip-dataset').textContent = item.dataset === 'agentnetbench_test' ? 'AgentNetBench test' : 'Memory bank';
  $('#chip-priority').hidden = !item.priority_group;
  $('#chip-priority').textContent = item.priority_group === 'encoder_n100_test'
    ? 'Encoder 핵심 Test'
    : item.priority_group === 'encoder_n100_memory' ? 'Encoder 대응 Memory' : '';
  const stratum = $('#chip-stratum');
  stratum.textContent = item.stratum === 'A' ? 'A · 재검토 대상' : 'B · 블라인드 감사';
  stratum.className = 'chip stratum-' + item.stratum;
  $('#chip-id').textContent = item.item_id;

  $('#ctx-instruction').textContent = item.task_instruction || '—';
  $('#ctx-action').textContent = item.current_action || '—';
  $('#ctx-code').textContent = item.raw_code || '—';
  configureAction(item);

  const hint = $('#model-hint');
  if (item.model_label) {
    hint.innerHTML = '';
    hint.append(el('h3', null, '에이전트 기존 라벨 (의심 항목 — 맞으면 그대로, 틀리면 고쳐 주세요)'));
    const dl = el('dl');
    ['task', 'target_form', 'action', 'domain'].forEach((axis) => {
      dl.append(el('dt', null, axis), el('dd', null, item.model_label[axis]));
    });
    hint.append(dl);
    if (item.flags && item.flags.length) {
      hint.append(el('p', 'why', '플래그: ' + item.flags.join(', ')));
    }
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }

  const img = $('#shot');
  img.src = item.image;
  img.width = item.image_w;
  img.height = item.image_h;
  S.zoom = 1;
  applyZoom();
  img.onload = placeMarker;
  placeMarker();

  updateProgress();
}

function placeMarker() {
  const item = S.current;
  const marker = $('#marker');
  const point = item && item.points && item.points[0];
  if (!point || !S.showMarker) { marker.classList.add('hidden'); }
  else {
    marker.classList.remove('hidden');
    marker.style.left = (point.x * 100) + '%';
    marker.style.top = (point.y * 100) + '%';
  }
  updateLoupe();
}

function updateLoupe() {
  const loupe = $('#loupe');
  const item = S.current;
  const point = item && item.points && item.points[0];
  if (!point || !S.showLoupe) { loupe.classList.add('hidden'); return; }
  loupe.classList.remove('hidden');
  const view = $('#loupe-img');
  const scale = 3;
  const w = item.image_w * scale;
  const h = item.image_h * scale;
  view.style.backgroundImage = `url("${item.image}")`;
  view.style.backgroundSize = `${w}px ${h}px`;
  view.style.backgroundPosition = `${(loupe.clientWidth / 2) - point.x * w}px ${(loupe.clientHeight / 2) - point.y * h}px`;
}

function applyZoom() {
  const canvas = $('#canvas');
  const img = $('#shot');
  const item = S.current;
  if (!item) return;
  if (S.zoom === 1) {
    canvas.classList.remove('zoomed');
    img.style.width = '';
  } else {
    canvas.classList.add('zoomed');
    img.style.width = (item.image_w * S.zoom) + 'px';
  }
  $('#btn-zoom').textContent = `확대 ${S.zoom}×`;
  if (S.zoom > 1) scrollToTarget();
}

function scrollToTarget() {
  const point = S.current && S.current.points && S.current.points[0];
  if (!point) return;
  const stage = $('#stage');
  const img = $('#shot');
  requestAnimationFrame(() => {
    stage.scrollLeft = point.x * img.clientWidth - stage.clientWidth / 2;
    stage.scrollTop = point.y * img.clientHeight - stage.clientHeight / 2;
  });
}

function updateProgress() {
  const total = S.queue.length;
  const at = Math.min(S.cursor, total);
  $('#progress-fill').style.width = total ? (at / total * 100) + '%' : '0%';
  $('#progress-text').textContent = `${at} / ${total}`;
}

function updateGlobalProgress(counts) {
  const total = S.items.reduce((sum, item) => sum + (item.labels_wanted || 1), 0);
  const finalTotal = (S.finalGoal.agentnetbench_items || 0) + (S.finalGoal.agentnet_items || 0);
  if (!counts) {
    $('#global-progress-fill').style.width = '0%';
    $('#global-progress-text').textContent = total ? `서버 확인 불가 · ${total}건` : '서버 확인 불가';
    $('#final-progress-fill').style.width = '0%';
    $('#final-progress-text').textContent = finalTotal ? `서버 확인 불가 · ${finalTotal.toLocaleString()}건` : '서버 확인 불가';
    return;
  }
  const completed = S.items.reduce(
    (sum, item) => sum + Math.min(counts.get(item.item_id) || 0, item.labels_wanted || 1), 0
  );
  const percent = total ? completed / total * 100 : 0;
  $('#global-progress-fill').style.width = percent + '%';
  $('#global-progress-text').textContent = `${completed} / ${total} · ${percent.toFixed(1)}%`;

  const completedCanonical = new Set(
    S.items
      .filter((item) => (item.dataset === 'agentnetbench_test' || item.source === 'agentnet') && (counts.get(item.item_id) || 0) > 0)
      .map((item) => item.canonical_item_id || item.item_id)
  ).size;
  const finalPercent = finalTotal ? completedCanonical / finalTotal * 100 : 0;
  $('#final-progress-fill').style.width = finalPercent + '%';
  $('#final-progress-text').textContent = `${completedCanonical.toLocaleString()} / ${finalTotal.toLocaleString()} · ${finalPercent.toFixed(2)}%`;
}

function globalProgressSummary(counts) {
  const total = S.items.reduce((sum, item) => sum + (item.labels_wanted || 1), 0);
  const completed = S.items.reduce(
    (sum, item) => sum + Math.min(counts.get(item.item_id) || 0, item.labels_wanted || 1), 0
  );
  const percent = total ? completed / total * 100 : 0;
  const finalTotal = (S.finalGoal.agentnetbench_items || 0) + (S.finalGoal.agentnet_items || 0);
  return `공개 큐 ${completed}/${total}건 (${percent.toFixed(1)}%) · 최종 목표 ${finalTotal.toLocaleString()}개`;
}

function renderDone() {
  const main = document.querySelector('.grid');
  main.innerHTML = '';
  const box = el('div', 'done');
  const inner = el('div');
  inner.append(el('h2', null, '남은 항목이 없습니다'));
  inner.append(el('p', null,
    `이번 세션에서 ${S.submittedThisSession}건 제출했습니다. ` +
    (S.pending.length ? `아직 서버에 못 보낸 ${S.pending.length}건이 있습니다 — 내보내기로 저장해 주세요.` : '모두 서버에 저장됐습니다. 감사합니다!')));
  const btn = el('button', 'primary', '내 라벨 내보내기 (JSONL)');
  btn.addEventListener('click', exportLabels);
  inner.append(btn);
  box.append(inner);
  main.append(box);
  updateProgress();
}

/* ── Submit ────────────────────────────────────────────────────── */
function buildRow() {
  const item = S.current;
  return {
    label_source: 'human',
    item_id: item.item_id,
    labeler_id: labelerId(),
    labeler_name: '',
    dataset: item.dataset,
    stratum: item.stratum,
    task: S.pick.task,
    target_form: S.pick.target_form,
    action: S.pick.action,
    domain: S.pick.domain,
    unsure: $('#unsure').checked,
    notes: $('#notes').value.slice(0, 2000),
    elapsed_ms: Math.min(86400000, Date.now() - S.startedAt),
    protocol: 'GUI Memory Taxonomy v10',
    client_ts: new Date().toISOString(),
    user_agent: navigator.userAgent.slice(0, 500),
  };
}

async function submit() {
  if (!complete()) return;
  const row = buildRow();
  S.done.add(row.item_id);
  saveJSON(LS.done, [...S.done]);
  S.submittedThisSession += 1;

  S.pending.push(row);
  saveJSON(LS.queue, S.pending);
  // Keep a full local copy too, so "내보내기" can recover everything this
  // person labeled even after the rows were accepted by the server.
  const all = loadJSON(LS.all, []);
  all.push(row);
  saveJSON(LS.all, all);

  S.cursor += 1;
  render();
  flushPending();

  // Other labelers have been working while this session ran, so re-read the
  // counts periodically and drop anything they have already finished. Without
  // this, a long session keeps serving work that is no longer needed.
  if (S.submittedThisSession % REFRESH_EVERY === 0) refreshQueue();
}

async function refreshQueue() {
  const counts = await fetchCounts();
  if (!counts.size) return;
  // Everything up to and including the item on screen stays put; only the
  // not-yet-shown tail is re-filtered, so the view never changes underfoot.
  const head = S.queue.slice(0, S.cursor + 1);
  const tail = S.queue.slice(S.cursor + 1).filter(
    (it) => !S.done.has(it.item_id) && (counts.get(it.item_id) || 0) < (it.labels_wanted || 1)
  );
  const dropped = S.queue.length - (head.length + tail.length);
  S.queue = head.concat(tail);
  if (dropped > 0) console.info(`${dropped} item(s) completed by other labelers — removed from queue`);
  updateProgress();
}

/* Plain INSERT, never an upsert: ON CONFLICT DO UPDATE requires SELECT
 * privilege on human_labels, and granting that would let any labeler read everyone
 * else's answers. Returns 'ok', 'duplicate' (already stored), or throws. */
async function postRows(rows) {
  const res = await fetch(`${REST}/human_labels`, {
    method: 'POST',
    headers: authHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (res.ok) return 'ok';
  const body = await res.text();
  if (res.status === 409 || body.includes('23505')) return 'duplicate';
  throw new Error('HTTP ' + res.status + ' ' + body.slice(0, 200));
}

async function flushPending() {
  if (!S.pending.length) { setSync(ONLINE ? 'ok' : 'off', ONLINE ? '서버 연결됨' : '로컬 저장 모드'); return; }
  if (!ONLINE) { setSync('off', `로컬 ${S.pending.length}건`); return; }
  setSync('pending', `전송 중 ${S.pending.length}건`);
  const batch = S.pending.slice(0, 20);
  try {
    const result = await postRows(batch);
    if (result === 'duplicate' && batch.length > 1) {
      // Postgres rejects the whole multi-row INSERT when any single row
      // duplicates, so retry individually rather than discarding the good rows.
      const stuck = [];
      for (const row of batch) {
        try {
          await postRows([row]);
        } catch (err) {
          console.warn('row kept for retry', err);
          stuck.push(row);
        }
      }
      S.pending = stuck.concat(S.pending.slice(batch.length));
      saveJSON(LS.queue, S.pending);
      setSync(stuck.length ? 'pending' : 'ok', stuck.length ? `대기 ${stuck.length}건` : '서버에 저장됨');
      if (!stuck.length) fetchCounts();
      return;
    }
    S.pending = S.pending.slice(batch.length);
    saveJSON(LS.queue, S.pending);
    if (S.pending.length) return flushPending();
    setSync('ok', '서버에 저장됨');
    fetchCounts();
  } catch (err) {
    console.warn('submit failed, kept locally', err);
    setSync('pending', `대기 ${S.pending.length}건`);
  }
}

function setSync(kind, text) {
  const badge = $('#sync-badge');
  badge.className = 'badge ' + kind;
  badge.textContent = text;
}

function exportLabels() {
  const all = loadJSON(LS.all, []);
  const body = all.map((r) => JSON.stringify(r)).join('\n');
  const blob = new Blob([body + (body ? '\n' : '')], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gui-taxonomy-human-labels-${labelerId().slice(-8)}.jsonl`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── UI wiring ─────────────────────────────────────────────────── */
function filterForms(term) {
  const q = term.trim().toLowerCase();
  document.querySelectorAll('#opts-target_form .opt').forEach((node) => {
    node.hidden = Boolean(q) && !node.dataset.search.includes(q);
  });
  document.querySelectorAll('#opts-target_form .group-opts').forEach((row) => {
    const visible = [...row.children].some((c) => !c.hidden);
    row.hidden = !visible;
    if (row.previousElementSibling && row.previousElementSibling.classList.contains('group-title')) {
      row.previousElementSibling.hidden = !visible;
    }
  });
}

function wireUI() {
  $('#btn-submit').addEventListener('click', submit);
  $('#btn-skip').addEventListener('click', () => { S.cursor += 1; render(); });
  $('#btn-export').addEventListener('click', exportLabels);
  $('#btn-help').addEventListener('click', () => { $('#help').hidden = false; });
  $('#help').addEventListener('click', (e) => {
    if (e.target.id === 'help' || e.target.dataset.close !== undefined) $('#help').hidden = true;
  });

  $('#btn-marker').addEventListener('click', () => {
    S.showMarker = !S.showMarker;
    $('#btn-marker').classList.toggle('active', S.showMarker);
    placeMarker();
  });
  $('#btn-loupe').addEventListener('click', () => {
    S.showLoupe = !S.showLoupe;
    $('#btn-loupe').classList.toggle('active', S.showLoupe);
    updateLoupe();
  });
  $('#btn-zoom').addEventListener('click', cycleZoom);
  $('#shot').addEventListener('click', cycleZoom);

  $('#search-target_form').addEventListener('input', (e) => filterForms(e.target.value));
  $('#search-target_form').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; filterForms(''); e.target.blur(); }
    if (e.key === 'Enter') {
      const first = [...document.querySelectorAll('#opts-target_form .opt')].find((n) => !n.hidden);
      if (first) { pick('target_form', first.dataset.value); e.target.blur(); }
    }
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('online', flushPending);
  window.addEventListener('resize', updateLoupe);
}

function cycleZoom() {
  S.zoom = S.zoom === 1 ? 2 : S.zoom === 2 ? 3 : 1;
  applyZoom();
}

function onKey(e) {
  if ($('#help').hidden === false && e.key === 'Escape') { $('#help').hidden = true; return; }
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === '?' && !typing) { $('#help').hidden = false; return; }
  if (typing) return;

  if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
  if (e.key === ']') { S.cursor += 1; render(); return; }
  if (e.key === 'f') { e.preventDefault(); $('#search-target_form').focus(); return; }
  if (e.key === 'm') { $('#btn-marker').click(); return; }
  if (e.key === 'z') { cycleZoom(); return; }
  if (e.key === 'l') { $('#btn-loupe').click(); return; }

  if (/^[1-8]$/.test(e.key)) {
    const value = S.vocab.task[Number(e.key) - 1];
    if (value) pick('task', value);
    return;
  }
}

boot();
