/*
 * aster-sync.js — sincroniza metadados do parceiro ASTER.
 *
 * Para cada colaborador ASTER (titulares via MgmChain 'ASTERDF' nível 1 + dependentes),
 * consulta a API do ASTER por CPF e extrai SOMENTE o campo `razao_social_empresa`.
 * Gera um arquivo .sql (DELETE + INSERT) que deve ser rodado MANUALMENTE no banco,
 * pois não temos acesso à API que cria metadados.
 *
 * Uso:
 *   node scripts/aster-sync.js              # todos os CPFs ASTER
 *   node scripts/aster-sync.js 45825253858  # apenas os CPFs informados (teste)
 *
 * Saída: scripts/out/aster-metadata.sql
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const META_NAME = 'razao_social_empresa';
const ASTER_CODES = ['ASTERDF'];
const API_URL = process.env.ASTER_API_URL;
const API_KEY = process.env.ASTER_API_KEY;
const OUT_FILE = path.join(__dirname, 'out', 'aster-metadata.sql');

// CPFs passados na linha de comando (somente dígitos) — para testar com poucos
const CLI_CPFS = process.argv.slice(2).map((s) => s.replace(/\D/g, '')).filter(Boolean);

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

// Resolve titulares + dependentes do parceiro ASTER (mesmo padrão de opUsersCte no server.js)
async function getAsterUsers(pool) {
  const ph = ASTER_CODES.map(() => '?').join(',');
  const sql = `
    WITH op_users AS (
      SELECT DISTINCT mc.idUser FROM MgmChain mc
      WHERE mc.mgmInvCode IN (${ph}) AND mc.nivel = 1
      UNION
      SELECT u.id FROM Users u
      INNER JOIN MgmChain mc ON mc.idUser = u.idUserParent AND mc.nivel = 1
      WHERE mc.mgmInvCode IN (${ph}) AND u.internalUser = 0
    )
    SELECT u.id AS idUser, u.cpf
    FROM Users u
    JOIN op_users ou ON ou.idUser = u.id
    WHERE u.cpf IS NOT NULL AND TRIM(u.cpf) <> ''
  `;
  const [rows] = await pool.query(sql, [...ASTER_CODES, ...ASTER_CODES]);
  return rows;
}

async function fetchRazaoSocial(cpfDigits) {
  const res = await fetch(`${API_URL}${cpfDigits}`, {
    headers: { 'Api-Key': API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(`API error: ${data.error}`);
  const razao = data && data.razao_social_empresa;
  return razao && String(razao).trim() ? String(razao).trim() : null;
}

async function main() {
  if (!API_URL || !API_KEY) {
    console.error('ASTER_API_URL / ASTER_API_KEY ausentes no .env');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  });

  try {
    let users = await getAsterUsers(pool);
    if (CLI_CPFS.length) {
      const set = new Set(CLI_CPFS);
      users = users.filter((u) => set.has(String(u.cpf).replace(/\D/g, '')));
      console.log(`Filtrando para ${CLI_CPFS.length} CPF(s) da linha de comando → ${users.length} usuário(s).`);
    }
    console.log(`Colaboradores ASTER com CPF: ${users.length}`);

    const tuples = [];
    let ok = 0;
    let semCampo = 0;
    const falhas = [];

    // Sequencial para não martelar a API
    for (const u of users) {
      const cpfDigits = String(u.cpf).replace(/\D/g, '');
      try {
        const razao = await fetchRazaoSocial(cpfDigits);
        if (!razao) {
          semCampo++;
          continue;
        }
        tuples.push(`(${u.idUser},'${META_NAME}','${sqlEscape(razao)}')`);
        ok++;
      } catch (err) {
        falhas.push({ idUser: u.idUser, cpf: cpfDigits, erro: err.message });
      }
    }

    // Monta o .sql: DELETE (idempotência) + INSERT multi-linha
    const idUsers = users.map((u) => u.idUser).join(',');
    let out = `-- Gerado por scripts/aster-sync.js\n`;
    out += `-- Metadado: ${META_NAME} (razão social da empresa do colaborador, via API ASTER)\n`;
    out += `-- Colaboradores ASTER consultados: ${users.length} | com valor: ${ok} | sem campo: ${semCampo} | falhas: ${falhas.length}\n\n`;

    if (tuples.length) {
      out += `DELETE FROM UsersMetadata WHERE name='${META_NAME}' AND idUser IN (${idUsers});\n\n`;
      out += `INSERT INTO UsersMetadata (idUser,name,value) VALUES\n${tuples.join(',\n')};\n`;
    } else {
      out += `-- Nenhum valor obtido da API; nada a inserir.\n`;
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, out, 'utf8');

    console.log(`\nResumo:`);
    console.log(`  com valor : ${ok}`);
    console.log(`  sem campo : ${semCampo}`);
    console.log(`  falhas    : ${falhas.length}`);
    if (falhas.length) {
      console.log(`  (primeiras falhas)`);
      falhas.slice(0, 10).forEach((f) => console.log(`    idUser=${f.idUser} cpf=${f.cpf} → ${f.erro}`));
    }
    console.log(`\nArquivo gerado: ${OUT_FILE}`);
    console.log(`Revise e rode esse SQL manualmente no banco.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
