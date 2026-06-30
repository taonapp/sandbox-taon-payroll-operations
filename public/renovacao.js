const BASE_PATH = '/payroll-ops';

const PARTNER_CONFIG = {
  hagana: {
    label: 'Haganá',
    cutoffDay: 20,
    hasRazaoSocial: false,
    communicationTag: 'renovacao_hagana',
    communicationTemplates: {
      renovando: 'Olá {nome}, sua mensalidade TaOn via folha da {empresa} foi renovada para {mes}.',
      saindo:    'Olá {nome}, seu plano TaOn via folha da {empresa} não foi renovado neste mês.',
    },
  },
  aster: {
    label: 'Aster',
    cutoffDay: 24,
    hasRazaoSocial: true,
    communicationTag: 'renovacao_aster',
    communicationTemplates: {
      renovando: 'Olá {nome}, sua mensalidade TaOn via folha da {empresa} ({razaoSocial}) foi renovada.',
      saindo:    'Olá {nome}, seu plano TaOn via folha da {empresa} não foi renovado neste mês.',
    },
  },
};

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const state = {
  view: 'renovacao',
  partner: 'hagana',
  configPartner: 'hagana',
  csvConfig: {},   // keyed by partner; stores how to parse the demitidos file
  files: [],       // demitidos files uploaded by user
  rows: [],        // parsed CPF rows from demitidos file
  reports: [],     // parse reports per file
  taonBase: [],
  diff: [],
  filterStatus: 'todos',
  step1Done: false,
  step2Done: false,
  step3Done: false,
  sampleHeaders: [],
  sampleRows: [],
};

// ===== CSV Parsing =====

function normalizeCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '').padStart(11, '0');
}

function detectDelimiter(line, configured) {
  if (configured && configured !== 'auto') return configured;
  if (line.includes('\t')) return '\t';
  const semicolons = (line.match(/;/g) || []).length;
  const commas     = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function splitCsvLine(line, delim) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch === delim) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}


function isCpfLikelyValid(raw) {
  const digits = String(raw || '').replace(/\D/g, '').padStart(11, '0');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(digits[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== Number(digits[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(digits[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === Number(digits[10]);
}

function isXlsxFile(file) {
  return /\.xlsx$/i.test(file.name);
}

function resolveFileType(file, cfgFileType) {
  if (cfgFileType === 'xlsx') return 'xlsx';
  if (cfgFileType === 'csv')  return 'csv';
  return isXlsxFile(file) ? 'xlsx' : 'csv';
}

function extractRowsFromMatrix(matrix, cfg) {
  if (!cfg || !cfg.columnMapping || !cfg.columnMapping.cpf) return null;

  const skip    = Number(cfg.headerRow) || 0;
  const headers = (matrix[skip] || []).map(h => String(h || '').trim());
  const cm      = cfg.columnMapping;

  const cpfIdx  = headers.indexOf(cm.cpf);
  const nameIdx = cm.name        ? headers.indexOf(cm.name)        : -1;
  const valIdx  = cm.valor       ? headers.indexOf(cm.valor)       : -1;
  const razIdx  = cm.razaoSocial ? headers.indexOf(cm.razaoSocial) : -1;

  if (cpfIdx === -1) return { error: `Coluna CPF "${cm.cpf}" não encontrada. Colunas detectadas: ${headers.join(', ')}` };

  const rows = [], rejected = [], warnings = [];
  const totalLines = matrix.length - skip - 1;

  for (let i = skip + 1; i < matrix.length; i++) {
    const cols   = matrix[i] || [];
    const lineNum = i + 1;
    const rawCpf  = String(cols[cpfIdx] || '').trim();

    if (!rawCpf) {
      rejected.push({ lineNum, reason: 'CPF vazio', raw: cols.join(' | ').slice(0, 80) });
      continue;
    }
    if (!isCpfLikelyValid(rawCpf)) {
      rejected.push({ lineNum, reason: `CPF inválido: "${rawCpf}"`, raw: cols.join(' | ').slice(0, 80) });
      continue;
    }

    const cpf    = normalizeCpf(rawCpf);
    const name   = nameIdx !== -1 ? String(cols[nameIdx] || '').trim() : '';
    const rawVal = valIdx  !== -1 ? String(cols[valIdx]  || '').trim() : '';
    const valor  = typeof cols[valIdx] === 'number'
      ? cols[valIdx]
      : parseFloat(rawVal.replace(/\./g, '').replace(',', '.')) || 0;

    if (valIdx !== -1 && rawVal && valor === 0) {
      warnings.push({ lineNum, field: 'valor', cpf, raw: rawVal, message: `Valor "${rawVal}" não reconhecido, usando 0` });
    }
    if (nameIdx !== -1 && !name) {
      warnings.push({ lineNum, field: 'nome', cpf, raw: '', message: 'Nome vazio' });
    }

    rows.push({ cpf, name, valor, razaoSocial: razIdx !== -1 ? String(cols[razIdx] || '').trim() : '' });
  }
  return { rows, rejected, warnings, totalLines };
}

function csvTextToMatrix(text, cfg) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd());
  const skip  = Number(cfg.headerRow) || 0;
  const delim = detectDelimiter(lines[skip] || '', cfg.delimiter);
  return lines.map(l => splitCsvLine(l, delim));
}

function xlsxBufferToMatrix(buf, cfg) {
  const wb       = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheetIdx = Number(cfg.sheetIndex) || 0;
  const sheetName = wb.SheetNames[sheetIdx] || wb.SheetNames[0];
  const ws       = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function parseCsvWithConfig(text, cfg) {
  const matrix = csvTextToMatrix(text, cfg);
  return extractRowsFromMatrix(matrix, cfg);
}

function parseXlsxWithConfig(buf, cfg) {
  const matrix = xlsxBufferToMatrix(buf, cfg);
  return extractRowsFromMatrix(matrix, cfg);
}

function extractHeadersFromMatrix(matrix, cfg) {
  const skip = Number(cfg.headerRow) || 0;
  return (matrix[skip] || []).map(h => String(h || '').trim()).filter(Boolean);
}

function extractSampleRows(matrix, cfg, n = 5) {
  const skip = Number(cfg.headerRow) || 0;
  return matrix.slice(skip + 1, skip + 1 + n);
}

function mergeFileRows(allFileResults) {
  const map = new Map();
  for (const result of allFileResults) {
    for (const r of result.rows) {
      map.set(r.cpf, r);
    }
  }
  return Array.from(map.values());
}

function renderParseReport(reports) {
  const el = document.getElementById('parseReport');
  if (!reports || reports.length === 0) { el.innerHTML = ''; return; }

  const totalValid    = reports.reduce((s, r) => s + r.rows.length, 0);
  const totalRejected = reports.reduce((s, r) => s + r.rejected.length, 0);
  const totalWarnings = reports.reduce((s, r) => s + r.warnings.length, 0);
  const totalLines    = reports.reduce((s, r) => s + r.totalLines, 0);

  const hasIssues = totalRejected > 0 || totalWarnings > 0;

  let html = `<div class="rnv-parse-report">
    <div class="rnv-parse-summary">
      <span class="rnv-parse-stat rnv-parse-ok">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ${totalValid} linha(s) válida(s)
      </span>`;

  if (totalRejected > 0) {
    html += `<span class="rnv-parse-stat rnv-parse-err">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ${totalRejected} ignorada(s)
      </span>`;
  }
  if (totalWarnings > 0) {
    html += `<span class="rnv-parse-stat rnv-parse-warn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${totalWarnings} aviso(s)
      </span>`;
  }
  html += `<span class="rnv-parse-stat" style="color:var(--text-muted)">${totalLines} linha(s) lida(s) no total</span>
    </div>`;

  if (reports.length > 1) {
    html += `<div class="rnv-parse-files">` + reports.map(r => `
      <div class="rnv-parse-file-row">
        <span class="rnv-parse-filename">${r.fileName}</span>
        <span class="rnv-parse-stat rnv-parse-ok" style="font-size:11px">${r.rows.length} válidas</span>
        ${r.rejected.length ? `<span class="rnv-parse-stat rnv-parse-err" style="font-size:11px">${r.rejected.length} ignoradas</span>` : ''}
        ${r.warnings.length ? `<span class="rnv-parse-stat rnv-parse-warn" style="font-size:11px">${r.warnings.length} avisos</span>` : ''}
      </div>`).join('') + `</div>`;
  }

  if (hasIssues) {
    const allRejected = reports.flatMap(r => r.rejected.map(x => ({ ...x, fileName: r.fileName })));
    const allWarnings = reports.flatMap(r => r.warnings.map(x => ({ ...x, fileName: r.fileName })));

    if (allRejected.length > 0) {
      html += `<details class="rnv-parse-details">
        <summary class="rnv-parse-details-toggle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Ver ${allRejected.length} linha(s) ignorada(s)
        </summary>
        <div style="overflow-x:auto;margin-top:8px">
          <table class="data-table">
            <thead><tr><th>Arquivo</th><th>Linha</th><th>Motivo</th><th>Conteúdo (início)</th></tr></thead>
            <tbody>${allRejected.map(r =>
              `<tr>
                <td style="font-size:11px">${r.fileName}</td>
                <td>${r.lineNum}</td>
                <td><span class="rnv-badge rnv-badge-saindo">${r.reason}</span></td>
                <td style="font-family:monospace;font-size:11px;color:var(--text-muted)">${escHtml(r.raw)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>`;
    }

    if (allWarnings.length > 0) {
      html += `<details class="rnv-parse-details">
        <summary class="rnv-parse-details-toggle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Ver ${allWarnings.length} aviso(s)
        </summary>
        <div style="overflow-x:auto;margin-top:8px">
          <table class="data-table">
            <thead><tr><th>Arquivo</th><th>Linha</th><th>CPF</th><th>Aviso</th></tr></thead>
            <tbody>${allWarnings.map(w =>
              `<tr>
                <td style="font-size:11px">${w.fileName}</td>
                <td>${w.lineNum}</td>
                <td style="font-family:monospace;font-size:11px">${w.cpf ? fmtCpf(w.cpf) : ''}</td>
                <td style="color:var(--text-muted);font-size:12px">${escHtml(w.message)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>`;
    }
  }

  html += '</div>';
  el.innerHTML = html;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== Diff =====

function computeDiff(taonBase, demitidosRows) {
  const taonMap      = new Map(taonBase.map(u => [normalizeCpf(u.cpf), u]));
  const demitidosSet = new Set(demitidosRows.map(r => normalizeCpf(r.cpf)));
  const result = [];
  for (const [cpf, taon] of taonMap) {
    result.push({
      cpf,
      name:        taon.name || '',
      idUserTaon:  taon.idUser,
      idUserPayer: taon.idUserPayer,
      payerName:   taon.payerName || '',
      amount:      Number(taon.amount) || 0,
      razaoSocial: taon.razaoSocialEmpresa || '',
      status:      demitidosSet.has(cpf) ? 'saindo' : 'renovando',
    });
  }
  return result;
}

// ===== Formatters =====

function fmtCpf(cpf) {
  const c = normalizeCpf(cpf);
  return `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`;
}

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function badgeHtml(status) {
  const labels = { renovando: 'Ativo', saindo: 'Saindo' };
  return `<span class="rnv-badge rnv-badge-${status}">${labels[status] || status}</span>`;
}

// ===== View toggle =====

function setView(view) {
  state.view = view;
  document.getElementById('viewRenovacao').style.display = view === 'renovacao' ? '' : 'none';
  document.getElementById('viewConfig').style.display    = view === 'config'    ? '' : 'none';
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

// ===== Wizard state =====

function renderStepEl(id, cls) {
  document.getElementById(id).className = `rnv-step ${cls}`;
}

function setStepState() {
  renderStepEl('step1', state.step1Done ? 'done' : 'active');
  renderStepEl('step2', !state.step1Done ? 'locked' : state.step2Done ? 'done' : 'active');
  renderStepEl('step3', !state.step2Done ? 'locked' : state.step3Done ? 'done' : 'active');
  renderStepEl('step4', !state.step3Done ? 'locked' : 'active');
}

function renderConfigWarning() {
  const cfg     = state.csvConfig[state.partner];
  const missing = !cfg || !cfg.columnMapping || !cfg.columnMapping.cpf;
  document.getElementById('configWarning').style.display = missing ? 'flex' : 'none';
  document.getElementById('btnCarregarBase').disabled = missing || state.files.length === 0 || state.rows.length === 0;
}

// ===== File list UI =====

function renderFileList() {
  const el = document.getElementById('fileList');
  if (state.files.length === 0) {
    el.style.display = 'none';
    document.getElementById('uploadZone').style.display = '';
    return;
  }
  document.getElementById('uploadZone').style.display = 'none';
  el.style.display = 'block';
  el.innerHTML = state.files.map((f, i) => `
    <div class="rnv-csv-info">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="rnv-csv-filename">${f.name}</span>
      <span class="rnv-csv-count">${(f.size/1024).toFixed(0)} KB</span>
      <button class="rnv-csv-clear" data-file-idx="${i}" title="Remover">&#x2715;</button>
    </div>
  `).join('') + `
    <div style="margin-top:8px;display:flex;gap:10px;align-items:center">
      <button class="rnv-btn rnv-btn-secondary rnv-btn-sm" id="btnAddMore">+ Adicionar mais</button>
      <button class="rnv-btn rnv-btn-secondary rnv-btn-sm" id="btnClearAll">Remover todos</button>
    </div>
  `;
  el.querySelectorAll('[data-file-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.files.splice(Number(btn.dataset.fileIdx), 1);
      renderFileList();
      parseAllFiles();
    });
  });
  document.getElementById('btnClearAll').addEventListener('click', () => {
    state.files = [];
    renderFileList();
    parseAllFiles();
  });
  document.getElementById('btnAddMore').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  renderConfigWarning();
}

// ===== File reading & parse-on-add =====

async function readFileText(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, encoding === 'latin1' ? 'ISO-8859-1' : 'UTF-8');
  });
}

async function readFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(new Uint8Array(e.target.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function parseFile(file, cfg) {
  const fileType = resolveFileType(file, cfg.fileType || 'auto');
  if (fileType === 'xlsx') {
    const buf = await readFileBuffer(file);
    return parseXlsxWithConfig(buf, cfg);
  }
  const text = await readFileText(file, cfg.encoding);
  return parseCsvWithConfig(text, cfg);
}

async function parseAllFiles() {
  const cfg = state.csvConfig[state.partner];
  if (!cfg || !cfg.columnMapping || !cfg.columnMapping.cpf) {
    state.reports = [];
    state.rows    = [];
    renderParseReport([]);
    renderConfigWarning();
    return;
  }
  const reports = [];
  for (const file of state.files) {
    const result = await parseFile(file, cfg);
    if (!result || result.error) {
      reports.push({ fileName: file.name, rows: [], rejected: [{ lineNum: 0, reason: result ? result.error : 'Config ausente', raw: '' }], warnings: [], totalLines: 0 });
    } else {
      reports.push({ fileName: file.name, ...result });
    }
  }
  state.reports = reports;
  state.rows    = mergeFileRows(reports);
  renderParseReport(reports);
  renderConfigWarning();
}

function addFiles(files) {
  const valid = files.filter(f => f.name.match(/\.(csv|xlsx|txt)$/i));
  if (valid.length === 0) return;
  const existing = new Set(state.files.map(f => f.name));
  valid.forEach(f => { if (!existing.has(f.name)) state.files.push(f); });
  renderFileList();
  parseAllFiles();
}

async function loadBaseAndDiff() {
  const loadingEl = document.getElementById('loadingBase');
  const btnEl     = document.getElementById('btnCarregarBase');
  loadingEl.style.display = '';
  btnEl.disabled = true;

  try {
    if (state.rows.length === 0) throw new Error('Nenhuma linha válida nos arquivos.');

    const res = await fetch(`${BASE_PATH}/api/renovacao/base?partner=${state.partner}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.taonBase = await res.json();
    state.diff     = computeDiff(state.taonBase, state.rows);

    state.step1Done = true;
    setStepState();
    renderDiffSummary();
    renderDiffTable();
  } catch (err) {
    alert(`Erro: ${err.message}`);
    btnEl.disabled = false;
  } finally {
    loadingEl.style.display = 'none';
  }
}

// ===== Diff rendering =====

function renderDiffSummary() {
  const renovando = state.diff.filter(r => r.status === 'renovando').length;
  const saindo    = state.diff.filter(r => r.status === 'saindo').length;
  document.getElementById('diffSummaryCards').innerHTML = `
    <div class="rnv-final-card">
      <div class="rnv-final-card-label">Ativos</div>
      <div class="rnv-final-card-value" style="color:var(--blue)">${renovando}</div>
    </div>
    <div class="rnv-final-card">
      <div class="rnv-final-card-label">Saindo</div>
      <div class="rnv-final-card-value" style="color:#ef4444">${saindo}</div>
    </div>
  `;
  document.getElementById('step2Badge').textContent = `${state.diff.length} na base`;
  document.getElementById('step2Badge').style.display = '';
}

function renderDiffTable() {
  const cfg  = PARTNER_CONFIG[state.partner];
  const rows = state.filterStatus === 'todos' ? state.diff : state.diff.filter(r => r.status === state.filterStatus);
  const headCols = cfg.hasRazaoSocial
    ? ['Status', 'Nome', 'CPF', 'Pagador', 'Razão Social', 'Valor']
    : ['Status', 'Nome', 'CPF', 'Pagador', 'Valor'];

  document.getElementById('diffTableHead').innerHTML = headCols.map(c => `<th>${c}</th>`).join('');
  document.getElementById('diffTableBody').innerHTML = rows.map(r => {
    const razaoCol = cfg.hasRazaoSocial ? `<td>${r.razaoSocial || ''}</td>` : '';
    return `<tr>
      <td>${badgeHtml(r.status)}</td>
      <td>${r.name || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="font-family:monospace;font-size:12px">${fmtCpf(r.cpf)}</td>
      <td>${r.payerName || '<span style="color:var(--text-muted)">—</span>'}</td>
      ${razaoCol}
      <td>${fmtMoney(r.amount)}</td>
    </tr>`;
  }).join('');
}

function renderCommPreview() {
  const cfg        = PARTNER_CONFIG[state.partner];
  const renovando  = state.diff.filter(r => r.status === 'renovando').length;
  const saindo     = state.diff.filter(r => r.status === 'saindo').length;
  const counts     = { renovando, saindo };
  const mesAtual   = MONTH_NAMES[new Date().getMonth()];
  const statusLabels = { renovando: 'Ativo', saindo: 'Saindo' };
  const statusColors = { renovando: 'rnv-badge-renovando', saindo: 'rnv-badge-saindo' };
  document.getElementById('commPreview').innerHTML = `
    <div style="margin-bottom:12px"><span class="rnv-comm-tag">${cfg.communicationTag}</span></div>
    <div class="rnv-comm-cards">
      ${Object.entries(cfg.communicationTemplates).map(([k, tpl]) => `
        <div class="rnv-comm-card">
          <div class="rnv-comm-card-header">
            <span class="rnv-badge ${statusColors[k]}">${statusLabels[k]}</span>
            <span class="rnv-comm-count">${counts[k]} usuário(s)</span>
          </div>
          <div class="rnv-comm-template">"${tpl.replace('{mes}', mesAtual)}"</div>
        </div>
      `).join('')}
    </div>`;
}

function renderFinalSummary() {
  const renovando = state.diff.filter(r => r.status === 'renovando');
  const total     = renovando.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  document.getElementById('finalSummary').innerHTML = `
    <div class="rnv-final-summary">
      <div class="rnv-final-card">
        <div class="rnv-final-card-label">Ativos</div>
        <div class="rnv-final-card-value" style="color:var(--blue)">${renovando.length}</div>
      </div>
      <div class="rnv-final-card">
        <div class="rnv-final-card-label">Saindo</div>
        <div class="rnv-final-card-value" style="color:#ef4444">${state.diff.length - renovando.length}</div>
      </div>
      <div class="rnv-final-card">
        <div class="rnv-final-card-label">Receita potencial</div>
        <div class="rnv-final-card-value" style="font-size:16px;margin-top:8px">${fmtMoney(total)}</div>
      </div>
    </div>
    <p class="rnv-step-desc">O arquivo XLSX terá apenas os usuários ativos.</p>`;
}

// ===== Export =====

async function doExport() {
  const loadingEl = document.getElementById('loadingExport');
  const btnEl     = document.getElementById('btnProcessar');
  loadingEl.style.display = '';
  btnEl.disabled = true;
  try {
    const res = await fetch(`${BASE_PATH}/api/renovacao/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: state.partner, rows: state.diff }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const cd   = res.headers.get('Content-Disposition') || '';
    const m    = cd.match(/filename="([^"]+)"/);
    a.download = m ? m[1] : `renovacao_${state.partner}.xlsx`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('doneBanner').style.display = 'flex';
  } catch (err) {
    alert(`Erro ao exportar: ${err.message}`);
    btnEl.disabled = false;
  } finally {
    loadingEl.style.display = 'none';
  }
}

// ===== Reset wizard =====

function resetWizard() {
  state.files    = [];
  state.rows     = [];
  state.reports  = [];
  state.taonBase = [];
  state.diff     = [];
  state.filterStatus = 'todos';
  state.step1Done = false;
  state.step2Done = false;
  state.step3Done = false;

  document.getElementById('fileList').style.display         = 'none';
  document.getElementById('uploadZone').style.display       = '';
  document.getElementById('doneBanner').style.display       = 'none';
  document.getElementById('btnProcessar').disabled          = false;
  document.getElementById('diffSummaryCards').innerHTML     = '';
  document.getElementById('diffTableBody').innerHTML        = '';
  document.getElementById('commPreview').innerHTML          = '';
  document.getElementById('finalSummary').innerHTML         = '';
  document.getElementById('step2Badge').style.display       = 'none';
  document.getElementById('parseReport').innerHTML          = '';
  setStepState();
  renderConfigWarning();
  document.querySelectorAll('#diffFilters .tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
}

// ===== Config tab =====

function updateCsvOnlyFields() {
  const fileType = document.getElementById('cfgFileType').value;
  const isXlsx   = fileType === 'xlsx' || (fileType === 'auto' && state.sampleHeaders.length > 0 && document.getElementById('cfgSheet').options.length > 1);
  document.getElementById('cfgDelimiterField').style.opacity = isXlsx ? '0.4' : '1';
  document.getElementById('cfgEncodingField').style.opacity  = isXlsx ? '0.4' : '1';
  document.getElementById('cfgSheetField').style.display     = fileType === 'csv' ? 'none' : '';
}

function loadConfigEditor() {
  const p   = state.configPartner;
  const cfg = state.csvConfig[p] || {};
  document.getElementById('cfgFileType').value  = cfg.fileType  || 'auto';
  document.getElementById('cfgDelimiter').value = cfg.delimiter || 'auto';
  document.getElementById('cfgEncoding').value  = cfg.encoding  || 'utf-8';
  document.getElementById('cfgHeaderRow').value = cfg.headerRow != null ? cfg.headerRow : 0;

  const sheetSelect = document.getElementById('cfgSheet');
  sheetSelect.innerHTML = '<option value="0">Primeira aba</option>';
  if (cfg.sheetIndex) sheetSelect.value = cfg.sheetIndex;

  state.sampleHeaders = [];
  state.sampleRows    = [];
  document.getElementById('detectedColumns').style.display = 'none';
  updateCsvOnlyFields();

  if (cfg.columnMapping && cfg.columnMapping.cpf) {
    const knownCols = [cfg.columnMapping.cpf, cfg.columnMapping.name].filter(Boolean);
    showSavedMapping(cfg.columnMapping, knownCols);
  }
}

function buildColumnOptions(selectEl, currentValue, nullable) {
  const headers = state.sampleHeaders;
  selectEl.innerHTML = (nullable ? '<option value="">(nenhum)</option>' : '') +
    headers.map(h => `<option value="${h}" ${h === currentValue ? 'selected' : ''}>${h}</option>`).join('');
}

function showSavedMapping(cm, extraHeaders) {
  if (state.sampleHeaders.length === 0 && extraHeaders.length > 0) {
    state.sampleHeaders = [...new Set(extraHeaders)];
  }
  if (state.sampleHeaders.length === 0) return;
  renderColumnChips(state.sampleHeaders);
  buildColumnOptions(document.getElementById('mapCpf'),  cm.cpf  || '', false);
  buildColumnOptions(document.getElementById('mapName'), cm.name || '', true);
  document.getElementById('detectedColumns').style.display = '';
  renderPreviewTable();
}

function renderColumnChips(headers) {
  document.getElementById('columnChips').innerHTML = headers.map(h =>
    `<span class="rnv-col-chip">${h}</span>`
  ).join('');
}

function renderPreviewTable() {
  if (state.sampleRows.length === 0) return;
  const headers = state.sampleHeaders;
  document.getElementById('previewHead').innerHTML = headers.map(h => `<th>${h}</th>`).join('');
  document.getElementById('previewBody').innerHTML = state.sampleRows.slice(0, 5).map(row =>
    `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`
  ).join('');
  document.getElementById('previewTable').parentElement.style.display = '';
}

async function handleSampleFile(file) {
  const p        = state.configPartner;
  const fileType = resolveFileType(file, document.getElementById('cfgFileType').value);
  const cfg = {
    fileType:   fileType,
    delimiter:  document.getElementById('cfgDelimiter').value,
    encoding:   document.getElementById('cfgEncoding').value,
    headerRow:  Number(document.getElementById('cfgHeaderRow').value) || 0,
    sheetIndex: Number(document.getElementById('cfgSheet').value) || 0,
  };

  let matrix;
  if (fileType === 'xlsx') {
    const buf = await readFileBuffer(file);
    const wb  = XLSX.read(buf, { type: 'array', cellDates: false });

    const sheetSelect = document.getElementById('cfgSheet');
    sheetSelect.innerHTML = wb.SheetNames.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    sheetSelect.value = cfg.sheetIndex;

    const ws = wb.Sheets[wb.SheetNames[cfg.sheetIndex]];
    matrix   = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } else {
    const text = await readFileText(file, cfg.encoding);
    matrix     = csvTextToMatrix(text, cfg);
  }

  const headers = extractHeadersFromMatrix(matrix, cfg);
  state.sampleHeaders = headers;
  state.sampleRows    = extractSampleRows(matrix, cfg);

  renderColumnChips(headers);
  const existing = (state.csvConfig[p] || {}).columnMapping || {};
  buildColumnOptions(document.getElementById('mapCpf'),  existing.cpf  || '', false);
  buildColumnOptions(document.getElementById('mapName'), existing.name || '', true);

  document.getElementById('detectedColumns').style.display = '';
  renderPreviewTable();
  updateCsvOnlyFields();
}

async function saveConfig() {
  const p     = state.configPartner;
  const saved = {
    fileType:   document.getElementById('cfgFileType').value,
    delimiter:  document.getElementById('cfgDelimiter').value,
    encoding:   document.getElementById('cfgEncoding').value,
    headerRow:  Number(document.getElementById('cfgHeaderRow').value) || 0,
    sheetIndex: Number(document.getElementById('cfgSheet').value) || 0,
    columnMapping: {
      cpf:  document.getElementById('mapCpf').value,
      name: document.getElementById('mapName').value || null,
    },
  };

  if (!saved.columnMapping.cpf) { alert('Selecione a coluna de CPF.'); return; }

  state.csvConfig[p] = saved;
  const fullConfig = { ...state.csvConfig };

  const loadingEl = document.getElementById('loadingSaveConfig');
  const okEl      = document.getElementById('saveConfigOk');
  loadingEl.style.display = '';
  okEl.style.display = 'none';

  try {
    const res = await fetch(`${BASE_PATH}/api/renovacao/csv-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullConfig),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    okEl.style.display = 'inline-flex';
    setTimeout(() => { okEl.style.display = 'none'; }, 3000);
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  } finally {
    loadingEl.style.display = 'none';
  }
}

// ===== Load config from server =====

async function loadCsvConfig() {
  try {
    const res = await fetch(`${BASE_PATH}/api/renovacao/csv-config`);
    state.csvConfig = await res.json();
  } catch (_) {
    state.csvConfig = {};
  }
}

// ===== Init =====

async function init() {
  await loadCsvConfig();
  setStepState();
  renderConfigWarning();

  // View tabs
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Go to config from warning
  document.getElementById('btnGoConfig').addEventListener('click', () => setView('config'));

  // Partner tabs (renovation)
  document.querySelectorAll('[data-partner]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.partner === state.partner) return;
      state.partner = btn.dataset.partner;
      document.querySelectorAll('[data-partner]').forEach(b => b.classList.toggle('active', b.dataset.partner === state.partner));
      resetWizard();
    });
  });

  // Partner tabs (config)
  document.querySelectorAll('[data-config-partner]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.configPartner = btn.dataset.configPartner;
      document.querySelectorAll('[data-config-partner]').forEach(b => b.classList.toggle('active', b.dataset.configPartner === state.configPartner));
      loadConfigEditor();
    });
  });

  // Upload zone
  const uploadZone = document.getElementById('uploadZone');
  const fileInput  = document.getElementById('fileInput');

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', e => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Diff filters
  document.querySelectorAll('#diffFilters .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filterStatus = btn.dataset.filter;
      document.querySelectorAll('#diffFilters .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === state.filterStatus));
      renderDiffTable();
    });
  });

  document.getElementById('btnCarregarBase').addEventListener('click', loadBaseAndDiff);
  document.getElementById('btnConfirmDiff').addEventListener('click', () => {
    state.step2Done = true;
    setStepState();
    renderCommPreview();
  });
  document.getElementById('btnConfirmComm').addEventListener('click', () => {
    state.step3Done = true;
    setStepState();
    renderFinalSummary();
  });
  document.getElementById('btnProcessar').addEventListener('click', doExport);

  // Config editor
  document.getElementById('sampleUploadZone').addEventListener('click', () => document.getElementById('sampleCsvInput').click());
  document.getElementById('sampleCsvInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleSampleFile(file);
    e.target.value = '';
  });
  document.getElementById('cfgFileType').addEventListener('change', updateCsvOnlyFields);
  ['cfgDelimiter', 'cfgEncoding', 'cfgHeaderRow', 'cfgSheet'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (state.sampleHeaders.length > 0) renderPreviewTable();
    });
  });
  ['mapCpf', 'mapName'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderPreviewTable);
  });
  document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);

  loadConfigEditor();
}

document.addEventListener('DOMContentLoaded', init);
