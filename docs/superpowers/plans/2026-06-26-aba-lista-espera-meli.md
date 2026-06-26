# Aba "Lista de Espera" no painel Meli — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma 4ª aba "Lista de Espera" ao painel `meli.html`, mostrando (read-only) os inscritos da espera por eSIM com KPIs, tabela filtrável e exportação CSV.

**Architecture:** Mudança puramente aditiva. Uma rota de leitura nova (`GET /api/meli/waitlist`) cross-query no schema `crm` reusando o pool MySQL existente; markup de aba seguindo o molde das abas atuais; lógica em `meli.js` com lazy-load no clique da aba. Nada do que existe é alterado.

**Tech Stack:** Node + Express 5 (`server.js`), MySQL via `mysql2/promise`, frontend vanilla JS/HTML/CSS em `public/`. Sem framework de teste, sem build step.

## Global Constraints

- **Repo:** `sandbox-taon-payroll-operations`, servido em `/payroll-ops/` (porta 3004 na EC2, atrás do auth do Portal TaOn).
- **Banco:** o pool MySQL conecta em `DB_NAME` (= `taon`). O schema `crm` está no mesmo servidor; referenciar como `crm.<tabela>`. O `DB_USER` precisa de `SELECT` em `crm.*`.
- **Campanha Meli no CRM:** `crm.campaigns.id = 5` (`name = 'mercado_livre'`).
- **Origem da espera por eSIM:** campo `leadSource` com valor casando `LIKE 'poc-meli%esim'` (cobre `poc-meli-esim` e `poc-meli-LP-esim`). Mostrar as duas.
- **Lead de teste:** existe `campaign_lead_field` com `type='test'` e `value='true'`. Caso contrário, é real. **Não** usar `register.istestuser` (não é confiável).
- **Timezone:** `crm.register.create_at` está em **UTC** (como o `taon`). **Formatar datas no SQL** (`DATE_FORMAT(DATE_SUB(..., INTERVAL 3 HOUR), ...)`) e exibir a string crua no JS — nunca devolver `Date` cru nem reaplicar conversão de fuso no front (armadilha do mysql2).
- **Front chama as rotas com prefixo:** `/payroll-ops/api/meli/...` (o `apiRouter` é montado em `/` e em `/payroll-ops`).
- **Deploy:** commit + push na `main` → CI (rsync para EC2 + restart). Nunca rsync/deploy manual.
- **Convenções de UI já existentes a reusar:** `.card`/`.accent-blue|green`/`.card-label`/`.card-value`, `.cards-row`, `.table-section`/`.table-header`/`.table-controls`/`.table-scroll`/`.data-table`, `.search-input`, `.filter-group`/`.filter-btn`, `.export-btn`, `.result-count`, `.pending-badge`, variáveis `--green`/`--text-muted`. Datas/números em `toLocaleString('pt-BR')`.

---

## File Structure

- **Modify** `server.js` — adicionar uma rota `GET /api/meli/waitlist` no `apiRouter`, junto das demais rotas `/api/meli/*`.
- **Modify** `public/meli.html` — adicionar o botão da aba na `.tab-bar` e o bloco `<div id="tabEspera">` com KPIs + tabela.
- **Modify** `public/meli.js` — globais da aba, wiring no switch de abas, `loadWaitlist()`, `renderWaitlist()`, listeners de filtro/busca e export CSV.

Sem arquivos novos. Sem CSS novo (reusa classes existentes).

---

## Task 1: Backend — rota `GET /api/meli/waitlist`

**Files:**
- Modify: `server.js` (inserir após a rota `/api/meli/pending-esim-contato`, que termina em `server.js:2126`, antes do comentário `// Consulta APN por lista de ICCIDs (POST)` em `server.js:2128`)

**Interfaces:**
- Consumes: `pool` (já definido em `server.js:11`), `apiRouter` (`server.js:26`).
- Produces: `GET /payroll-ops/api/meli/waitlist` → JSON array de objetos:
  `{ registerid: number, criadoEm: string ("DD/MM/YYYY HH:mm" BRL), origem: string, whatsapp: string, email: string, isTeste: 0|1, isHoje: 0|1, is7d: 0|1, is30d: 0|1 }`, ordenado por mais recente primeiro.

- [ ] **Step 1: Adicionar a rota**

Inserir este bloco logo após o fechamento (`});`) da rota `/api/meli/pending-esim-contato` em `server.js:2126`:

```js
// Lista de espera eSIM (landing poc-meli-taon-esim) — leads no CRM, campanha 5
apiRouter.get('/api/meli/waitlist', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH waitlist AS (
        SELECT r.id AS registerid, r.create_at
        FROM crm.register r
        WHERE r.campaignid = 5
          AND EXISTS (
            SELECT 1 FROM crm.campaign_lead_field s
            WHERE s.registerid = r.id
              AND s.type = 'leadSource'
              AND s.value LIKE 'poc-meli%esim'
          )
      )
      SELECT
        w.registerid,
        DATE_FORMAT(DATE_SUB(w.create_at, INTERVAL 3 HOUR), '%d/%m/%Y %H:%i') AS criadoEm,
        MAX(CASE WHEN clf.type = 'leadSource' THEN clf.value END) AS origem,
        MAX(CASE WHEN clf.type = 'whatsapp'   THEN clf.value END) AS whatsapp,
        MAX(CASE WHEN clf.type = 'email'      THEN clf.value END) AS email,
        MAX(CASE WHEN clf.type = 'test' AND clf.value = 'true' THEN 1 ELSE 0 END) AS isTeste,
        CASE WHEN DATE(DATE_SUB(w.create_at, INTERVAL 3 HOUR))
                  = DATE(DATE_SUB(NOW(), INTERVAL 3 HOUR)) THEN 1 ELSE 0 END AS isHoje,
        CASE WHEN DATE_SUB(w.create_at, INTERVAL 3 HOUR)
                  >= DATE_SUB(DATE_SUB(NOW(), INTERVAL 3 HOUR), INTERVAL 7 DAY) THEN 1 ELSE 0 END AS is7d,
        CASE WHEN DATE_SUB(w.create_at, INTERVAL 3 HOUR)
                  >= DATE_SUB(DATE_SUB(NOW(), INTERVAL 3 HOUR), INTERVAL 30 DAY) THEN 1 ELSE 0 END AS is30d
      FROM waitlist w
      JOIN crm.campaign_lead_field clf ON clf.registerid = w.registerid
      GROUP BY w.registerid, w.create_at
      ORDER BY w.create_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Meli waitlist error:', err);
    res.status(500).json({ error: 'Erro ao consultar lista de espera' });
  }
});
```

- [ ] **Step 2: Subir o servidor local**

Pré-requisito: `.env` preenchido (`cp .env.example .env`) apontando para o MySQL com acesso ao schema `crm` (`DB_NAME=taon`), e `npm install` rodado.

Run: `npm run dev`
Expected: log do Express subindo na porta 3004, sem erro.

- [ ] **Step 3: Verificar o endpoint com curl**

Run: `curl -s http://localhost:3004/api/meli/waitlist | head -c 800`
Expected: um array JSON. Hoje (2026-06-26) deve trazer **6 objetos**; exatamente **1** com `isTeste: 0` (email `wilsonlira@me.com`) e **5** com `isTeste: 1`. Campos `criadoEm` no formato `26/06/2026 14:01`, `origem` ∈ {`poc-meli-esim`, `poc-meli-LP-esim`}.

- [ ] **Step 4: Conferir contra o banco (sanity)**

Run (no MySQL, ou via ferramenta de query):
```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM crm.campaign_lead_field t
            WHERE t.registerid=r.id AND t.type='test' AND t.value='true') THEN 1 ELSE 0 END) AS testes
FROM crm.register r
WHERE r.campaignid=5
  AND EXISTS (SELECT 1 FROM crm.campaign_lead_field s
              WHERE s.registerid=r.id AND s.type='leadSource' AND s.value LIKE 'poc-meli%esim');
```
Expected: `total` e `testes` batendo com o array do Step 3 (`total` = nº de objetos; `testes` = nº de `isTeste:1`).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(meli): add /api/meli/waitlist endpoint (lista de espera eSIM)"
```

---

## Task 2: Frontend — markup da aba "Lista de Espera"

**Files:**
- Modify: `public/meli.html` (botão de aba na `.tab-bar`, `meli.html:78-82`; bloco da aba após `</div><!-- /tabEstoque -->` em `meli.html:592`)

**Interfaces:**
- Consumes: classes/estilos existentes (ver Global Constraints).
- Produces: elementos com IDs que a Task 3 consome — `tabEspera`, `weTotal`, `weHoje`, `weSete`, `weTrinta`, `weSearch`, `weExport`, `weLoading`, `weResultCount`, `weTableBody`; botões `[data-we-filter]` (valores `real`/`teste`/`all`); botão de aba `[data-tab="espera"]`.

- [ ] **Step 1: Adicionar o botão da aba**

Em `public/meli.html`, na `.tab-bar` (atualmente `meli.html:78-82`), adicionar o 4º botão após o de "Estoque de Chips":

```html
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="ativacao">Ativacao</button>
      <button class="tab-btn" data-tab="movimentos">Movimentos</button>
      <button class="tab-btn" data-tab="estoque">Estoque de Chips</button>
      <button class="tab-btn" data-tab="espera">Lista de Espera</button>
    </div>
```

- [ ] **Step 2: Adicionar o bloco de conteúdo da aba**

Inserir este bloco imediatamente após `</div><!-- /tabEstoque -->` (`meli.html:592`) e antes do `</div>` que fecha `#page` (`meli.html:594`):

```html
      <!-- TAB LISTA DE ESPERA -->
      <div id="tabEspera" class="tab-content hidden">
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 16px">
          Aparelhos sem eSIM aguardando liberacao do chip fisico — inscritos pela landing eSIM Meli.
        </p>

        <section class="cards-row">
          <div class="card accent-blue">
            <span class="card-label">Total na lista</span>
            <span class="card-value" id="weTotal">-</span>
          </div>
          <div class="card accent-green">
            <span class="card-label">Novos hoje</span>
            <span class="card-value" id="weHoje">-</span>
          </div>
          <div class="card accent-blue">
            <span class="card-label">Ultimos 7 dias</span>
            <span class="card-value" id="weSete">-</span>
          </div>
          <div class="card accent-blue">
            <span class="card-label">Ultimos 30 dias</span>
            <span class="card-value" id="weTrinta">-</span>
          </div>
        </section>

        <section class="table-section">
          <div class="card">
            <div class="table-header">
              <span class="card-label">Inscritos</span>
              <div class="table-controls">
                <input type="text" class="search-input" id="weSearch" placeholder="Buscar por WhatsApp ou e-mail...">
                <div class="filter-group">
                  <button class="filter-btn active" data-we-filter="real">Real</button>
                  <button class="filter-btn" data-we-filter="teste">Teste</button>
                  <button class="filter-btn" data-we-filter="all">Todos</button>
                </div>
                <button class="export-btn" id="weExport">Exportar CSV</button>
                <span class="result-count" id="weResultCount"></span>
              </div>
            </div>
            <div id="weLoading" style="text-align:center;color:var(--text-muted);padding:40px 0">Carregando...</div>
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>WhatsApp</th>
                    <th>E-mail</th>
                    <th>Origem</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody id="weTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>
      </div><!-- /tabEspera -->
```

- [ ] **Step 3: Verificar no navegador (sem dados ainda)**

Com `npm run dev` rodando, abrir `http://localhost:3004/payroll-ops/meli.html`. Clicar na aba "Lista de Espera".
Expected: a aba aparece na barra; ao clicar, as outras abas somem e aparecem os 4 cards de KPI (com "-") + a tabela vazia com o cabeçalho. (Ainda não carrega dados — isso é a Task 3. Pode aparecer "Carregando..." parado, ok.)

- [ ] **Step 4: Commit**

```bash
git add public/meli.html
git commit -m "feat(meli): add Lista de Espera tab markup"
```

---

## Task 3: Frontend — lógica da aba (load, KPIs, filtro, busca, export)

**Files:**
- Modify: `public/meli.js` (globais perto de `meli.js:7`; bloco de tabs em `meli.js:1044-1061`; novo bloco de funções/listeners antes de `loadAll();` em `meli.js:1677`)

**Interfaces:**
- Consumes: `GET /payroll-ops/api/meli/waitlist` (Task 1); helper `$` (`meli.js:1`); IDs/atributos da Task 2.
- Produces: nada para tarefas posteriores (última task).

- [ ] **Step 1: Adicionar as globais da aba**

Em `public/meli.js`, após a linha `let selectedRefDate = '';` (`meli.js:7`), adicionar:

```js
let waitlistLeads = [];
let waitlistFilter = 'real';
let waitlistSearch = '';
let waitlistLoaded = false;
```

- [ ] **Step 2: Ligar a aba no switch de abas**

Substituir o bloco do switch de abas (`meli.js:1044-1061`) por esta versão, que adiciona o toggle de `#tabEspera` e o lazy-load:

```js
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;

    $('tabAtivacao').classList.toggle('hidden', activeTab !== 'ativacao');
    $('tabMovimentos').classList.toggle('hidden', activeTab !== 'movimentos');
    $('tabEstoque').classList.toggle('hidden', activeTab !== 'estoque');
    $('tabEspera').classList.toggle('hidden', activeTab !== 'espera');

    if (activeTab === 'estoque' && !stockLoaded) {
      loadStock();
    }
    if (activeTab === 'movimentos' && !movementsLoaded) {
      loadMovementsTab();
    }
    if (activeTab === 'espera' && !waitlistLoaded) {
      loadWaitlist();
    }
  });
});
```

- [ ] **Step 3: Adicionar load + render + listeners + export**

Inserir este bloco antes da chamada final `loadAll();` (`meli.js:1677`):

```js
// === LISTA DE ESPERA ===
const weOrigemLabel = (o) =>
  o === 'poc-meli-LP-esim' ? 'Landing (producao)'
  : o === 'poc-meli-esim' ? 'Sandbox'
  : (o || '-');

async function loadWaitlist() {
  $('weLoading').textContent = 'Carregando...';
  $('weLoading').classList.remove('hidden');
  try {
    const res = await fetch('/payroll-ops/api/meli/waitlist');
    if (!res.ok) throw new Error('API error');
    waitlistLeads = await res.json();
    waitlistLoaded = true;
    $('weLoading').classList.add('hidden');
    renderWaitlistKpis();
    renderWaitlist();
  } catch (err) {
    $('weLoading').textContent = 'Erro ao carregar a lista de espera.';
    console.error('Waitlist load error:', err);
  }
}

function renderWaitlistKpis() {
  const reais = waitlistLeads.filter(l => Number(l.isTeste) === 0);
  const sum = (key) => reais.reduce((s, l) => s + Number(l[key] || 0), 0);
  $('weTotal').textContent = reais.length;
  $('weHoje').textContent = sum('isHoje');
  $('weSete').textContent = sum('is7d');
  $('weTrinta').textContent = sum('is30d');
}

function waitlistFiltered() {
  const term = waitlistSearch.toLowerCase();
  return waitlistLeads.filter(l => {
    const teste = Number(l.isTeste) === 1;
    if (waitlistFilter === 'real' && teste) return false;
    if (waitlistFilter === 'teste' && !teste) return false;
    if (term) {
      const hay = (String(l.whatsapp || '') + ' ' + String(l.email || '')).toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

function renderWaitlist() {
  const tbody = $('weTableBody');
  tbody.innerHTML = '';
  const filtered = waitlistFiltered();
  $('weResultCount').textContent = `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhum inscrito encontrado</td></tr>';
    return;
  }

  filtered.forEach(l => {
    const teste = Number(l.isTeste) === 1;
    const tipoBadge = teste
      ? '<span class="pending-badge" style="background:var(--text-muted)">Teste</span>'
      : '<span class="pending-badge" style="background:var(--green)">Real</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.criadoEm || '-'}</td>
      <td style="font-family:monospace">${l.whatsapp || '-'}</td>
      <td style="font-family:monospace">${l.email || '-'}</td>
      <td>${weOrigemLabel(l.origem)}</td>
      <td>${tipoBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

$('weSearch').addEventListener('input', (e) => {
  waitlistSearch = e.target.value.trim();
  renderWaitlist();
});

document.querySelectorAll('[data-we-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-we-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    waitlistFilter = btn.dataset.weFilter;
    renderWaitlist();
  });
});

$('weExport').addEventListener('click', () => {
  const filtered = waitlistFiltered();
  if (filtered.length === 0) return;
  const escape = (v) => {
    const s = String(v || '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'Data,WhatsApp,Email,Origem,Tipo';
  const lines = filtered.map(l =>
    [escape(l.criadoEm), escape(l.whatsapp), escape(l.email), escape(weOrigemLabel(l.origem)),
     Number(l.isTeste) === 1 ? 'Teste' : 'Real'].join(',')
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meli_lista_espera_esim.csv';
  a.click();
  URL.revokeObjectURL(url);
});
```

- [ ] **Step 4: Verificar a aba completa no navegador**

Com `npm run dev` rodando, recarregar `http://localhost:3004/payroll-ops/meli.html` e abrir a aba "Lista de Espera".
Expected (hoje, 2026-06-26):
- KPIs: Total na lista = **1** (só os reais), Novos hoje = **1**, 7 dias = **1**, 30 dias = **1**.
- Tabela com filtro default "Real": **1 linha** (`wilsonlira@me.com`), badge verde "Real".
- Clicar "Teste": **5 linhas**, badges cinza "Teste".
- Clicar "Todos": **6 linhas**.
- Buscar parte de um e-mail/WhatsApp: filtra as linhas; `weResultCount` atualiza.
- "Exportar CSV": baixa `meli_lista_espera_esim.csv` com as colunas Data/WhatsApp/Email/Origem/Tipo respeitando o filtro ativo (abrir no Excel/Sheets e conferir acentuação via BOM).

- [ ] **Step 5: Verificar que as abas existentes não regrediram**

Clicar em "Ativacao", "Movimentos" e "Estoque de Chips".
Expected: cada uma funciona exatamente como antes (carregam dados, gráficos e tabelas normalmente).

- [ ] **Step 6: Commit**

```bash
git add public/meli.js
git commit -m "feat(meli): wire Lista de Espera tab (load, KPIs, filter, search, CSV)"
```

---

## Deploy (após aprovação dos commits)

```bash
git push origin main
```
O workflow `.github/workflows/deploy.yml` faz rsync para a EC2 e reinicia o serviço. Smoke test pós-deploy (precisa estar logado no Portal TaOn no navegador):
- Abrir `https://sandbox.taon.app/payroll-ops/meli.html` → aba "Lista de Espera" carrega KPIs + tabela.

**Atenção de deploy:** confirmar que o `DB_USER` configurado no `.env` da EC2 tem `SELECT` no schema `crm`. Se a aba retornar erro 500 com "Erro ao consultar lista de espera", checar os logs do serviço e a permissão cross-schema do usuário MySQL.

---

## Self-Review

**Spec coverage:**
- Rota de leitura cross-query `crm` → Task 1. ✔
- Filtro de origem `poc-meli%esim` (as duas) com origem visível → Task 1 (SQL) + Task 3 (coluna Origem). ✔
- Regra de teste `type='test'`/`value='true'`, default "Real" → Task 1 (`isTeste`) + Task 3 (filtro default `real`). ✔
- KPIs Total/Hoje/7d/30d sobre reais → Task 1 (flags) + Task 3 (`renderWaitlistKpis`). ✔
- Tabela com busca + tabela de inscritos → Task 2 (markup) + Task 3 (render/busca). ✔
- Export CSV → Task 3. ✔
- Linha de contexto → Task 2. ✔
- Reuso de estilos / sem CSS novo → Tasks 2 e 3 usam só classes existentes. ✔
- Deploy via push/CI → seção Deploy. ✔
- Não-objetivos (edição/pipeline/disparo) → não implementados. ✔

**Placeholder scan:** sem TBD/TODO; todo código está completo e literal.

**Type consistency:** `weOrigemLabel`, `waitlistFiltered`, `renderWaitlist`, `renderWaitlistKpis`, `loadWaitlist` usados de forma consistente; IDs (`weTotal/weHoje/weSete/weTrinta/weSearch/weExport/weLoading/weResultCount/weTableBody`) e atributos (`data-we-filter`, `data-tab="espera"`) batem entre Task 2 e Task 3; campos do JSON (`criadoEm/origem/whatsapp/email/isTeste/isHoje/is7d/is30d`) idênticos entre Task 1 (produz) e Task 3 (consome).
