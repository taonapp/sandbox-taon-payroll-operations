# Aba "Lista de Espera" no painel Ativação Meli

**Data:** 2026-06-26
**Repo:** `sandbox-taon-payroll-operations` (servido em `/payroll-ops/meli.html`, porta 3004 na EC2)
**Status:** Design aprovado — aguardando revisão do spec antes do plano de implementação

## Problema

A landing eSIM (`poc-meli-taon-esim`) ganhou hoje uma **lista de espera**: quando o
aparelho do transportador não tem eSIM (sem EID), ele deixa WhatsApp + e-mail para
ser avisado quando o chip físico for liberado. Esses contatos vão para o CRM, mas
hoje **não têm nenhuma visibilidade** no painel operacional. Quem acompanha a campanha
Meli não consegue ver o tamanho nem a evolução dessa demanda reprimida.

## Objetivo

Adicionar uma 4ª aba — **Lista de Espera** — ao painel `meli.html`, dando visibilidade
(read-only) aos inscritos da espera por eSIM. A aba serve para (a) medir a tração da
landing e (b) gerar uma lista exportável para reativação quando o chip físico liberar.

**Não-objetivos (YAGNI):** editar leads, status de pipeline, disparo de mensagem,
integração de campanha. A aba é só de visibilidade + exportação.

## Onde os dados moram

O proxy `POST /portal/api/meli-esim-leads` (repo `sandbox-taon`) é fire-and-forget:
recebe o lead e repassa ao CRM, **sem persistir localmente**. Os leads ficam no banco
MySQL `crm`, no mesmo servidor que o painel já acessa.

Modelo de dados (EAV):

- `crm.register` — um registro por lead: `id`, `campaignid`, `istestuser`, `create_at`.
- `crm.campaign_lead_field` — um registro por campo do lead: `registerid`, `type`, `value`.

Campanha Meli = `campaignid = 5` (`crm.campaigns.name = 'mercado_livre'`). A campanha 5
contém **outros** leads além da espera (chatbot/agente: `driverId`, `agent_meli_*`),
então **não** se filtra pela campanha inteira — filtra-se pela origem.

### Identificação dos leads da espera por eSIM

Um lead é da lista de espera quando tem um campo `type='leadSource'` com valor
`poc-meli-esim` **ou** `poc-meli-LP-esim` (validado: `value LIKE 'poc-meli%esim'`).
A aba mostra **as duas origens**, com a origem visível numa coluna.

### Identificação de lead de teste (validado contra os dados)

`register.istestuser` **não é confiável** (todos os 6 leads atuais vêm como `0`, mesmo
os de QA). O sinal correto, confirmado pelos dados: um lead é **TESTE** quando existe
`campaign_lead_field` com `type='test'` e `value='true'`; caso contrário é **REAL**.
(Hoje: 5 de 6 são teste; 1 é real.)

## Arquitetura da mudança

Mudança aditiva — nada do que existe é alterado. Três pontos de toque, todos seguindo
padrões já presentes no repo:

### 1. Backend — nova rota de leitura (`server.js`)

`GET /api/meli/waitlist` — segue o mesmo molde das rotas `/api/meli/*` existentes
(usa o `pool` MySQL já configurado, cross-query no schema `crm`). Retorna a lista
achatada + os KPIs já computados no SQL.

Query base (pivot do EAV):

```sql
SELECT
  r.id AS registerid,
  r.create_at AS criadoEm,
  MAX(CASE WHEN clf.type='leadSource' THEN clf.value END) AS origem,
  MAX(CASE WHEN clf.type='whatsapp'   THEN clf.value END) AS whatsapp,
  MAX(CASE WHEN clf.type='email'      THEN clf.value END) AS email,
  MAX(CASE WHEN clf.type='test' AND clf.value='true' THEN 1 ELSE 0 END) AS isTeste
FROM crm.register r
JOIN crm.campaign_lead_field clf ON clf.registerid = r.id
WHERE r.campaignid = 5
  AND EXISTS (
    SELECT 1 FROM crm.campaign_lead_field s
    WHERE s.registerid = r.id
      AND s.type = 'leadSource'
      AND s.value LIKE 'poc-meli%esim'
  )
GROUP BY r.id, r.create_at
ORDER BY r.create_at DESC;
```

Resposta JSON:

```json
{
  "kpis": { "total": 6, "hoje": 6, "sete": 6, "trinta": 6 },
  "leads": [
    { "registerid": 24503, "criadoEm": "2026-06-26T17:01:00",
      "origem": "poc-meli-esim", "whatsapp": "5511000000000",
      "email": "wilsonlira@me.com", "isTeste": 0 }
  ]
}
```

Os KPIs (total / hoje / 7 dias / 30 dias) consideram apenas leads **reais** (`isTeste=0`),
em horário de Brasília (o servidor é UTC — aplicar `INTERVAL 3 HOUR` como as outras rotas).

### 2. Frontend — markup da aba (`public/meli.html`)

- Adicionar `<button class="tab-btn" data-tab="espera">Lista de Espera</button>` à `.tab-bar`.
- Adicionar `<div id="tabEspera" class="tab-content hidden">` com:
  - 1 linha de contexto ("Aparelhos sem eSIM aguardando liberação do chip físico").
  - Faixa de 4 cards (`.card` + `.card-label` + `.card-value`): Total · Hoje · 7 dias · 30 dias.
  - Bloco `.table-section` com `.table-header` (busca `.search-input`, filtro
    `.filter-btn` Todos/Real/Teste, botão `.export-btn` "Exportar CSV") e uma
    `table.data-table` com colunas: **Data·hora | WhatsApp | E-mail | Origem | Tipo**.

Reaproveita 100% das classes/estilos já existentes — sem CSS novo (ou mínimo, se preciso
de um badge "TESTE", reusar `.pending-badge`).

### 3. Frontend — lógica (`public/meli.js`)

- Registrar a aba `espera` no mecanismo de troca de abas já existente (carregamento
  preguiçoso: busca os dados na primeira vez que a aba é aberta, como as outras).
- `fetch('/api/meli/waitlist')` → renderiza KPIs + tabela.
- Filtro Todos/Real/Teste e busca por texto no client (mesma mecânica do filtro da
  tabela de usuários). Padrão default: **Real**.
- Datas via `toLocaleString('pt-BR')` (convenção do repo).
- Exportar CSV no client (WhatsApp + e-mail + origem + data) — suficiente para reativação.

## Plano de teste

- Local: `cp .env.example .env`, apontar para o MySQL (DB com acesso ao schema `crm`),
  `npm install && npm run dev`, abrir `/payroll-ops/meli.html`, clicar na aba.
- Verificar: KPIs batem com a query manual; filtro Real esconde os 5 de QA e mostra 1;
  filtro Teste mostra os 5; busca funciona; CSV abre com as colunas certas.
- Regressão: as 3 abas existentes continuam idênticas (mudança é aditiva).

## Riscos / pontos de atenção

- **Acesso ao schema `crm`:** a query cross-schema exige que o `DB_USER` do painel
  tenha `SELECT` em `crm.*`. Confirmar no deploy (o usuário do MCP enxerga; o do painel
  precisa enxergar também).
- **Ruído de QA no lançamento:** enquanto a landing está em teste, a maioria dos leads
  é `test=true`. O filtro default "Real" mitiga, mas a base real ainda é pequena (1 hoje).
- **Deploy:** via GitHub (push na `main` → CI), nunca rsync/deploy.sh manual, para
  preservar o versionamento (convenção TaOn).
