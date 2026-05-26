require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3004;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// Parse Meli CSV (Base_TaOn)
const meliCsvMap = new Map();
try {
  const csvPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'Base_TaOn_202605.csv');
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const [driverId, levelNum, levelName, movement] = lines[i].split(',');
    meliCsvMap.set(driverId.trim(), {
      csvLevelNum: Number(levelNum),
      csvLevelName: levelName.trim(),
      csvMovement: movement.trim(),
    });
  }
  console.log(`Meli CSV loaded: ${meliCsvMap.size} drivers`);
} catch (err) {
  console.warn('Could not load Meli CSV:', err.message);
}

const PREFIX = '/payroll-ops';
const apiRouter = express.Router();

// Serve static files at root and under prefix (for nginx proxy)
app.use(express.static(path.join(__dirname, 'public')));
app.use(PREFIX, express.static(path.join(__dirname, 'public')));

// Redirect prefix root to index
app.get(PREFIX, (req, res) => res.redirect(`${PREFIX}/`));

function buildDashboardQuery(cutoffFilter, { requireSimCard = true } = {}) {
  return `
    WITH base_payroll AS (
        SELECT DISTINCT rpc.idUser
        FROM RecurringPurchasesConfig rpc
        LEFT JOIN Users u ON u.id = rpc.idUser
        LEFT JOIN Products p ON p.id = rpc.idProduct
        WHERE rpc.paymentMethod = 'payroll'
          AND rpc.idStatus = 1
          AND u.status = 'enabled'
          AND u.internalUser = 0
          AND p.\`type\` = 'main'
          ${cutoffFilter}
    ),
    recurring_main AS (
        SELECT *
        FROM (
            SELECT
                rpc.idProduct,
                rpc.idUser,
                rpc.idUserPayer,
                rpc.amount,
                rpc.paymentMethod,
                rpc.idCompany,
                rpc.cdate,
                ROW_NUMBER() OVER (
                    PARTITION BY rpc.idUser
                    ORDER BY rpc.cdate DESC
                ) AS rn
            FROM RecurringPurchasesConfig rpc
            LEFT JOIN Products p ON p.id = rpc.idProduct
            WHERE p.\`type\` LIKE 'main%'
              AND rpc.idStatus = 1
              AND rpc.paymentMethod = 'payroll'
        ) x
        WHERE rn = 1
    ),
    first_purchase AS (
        SELECT *
        FROM (
            SELECT
                pp.idUser,
                pp.dateStart,
                ROW_NUMBER() OVER (
                    PARTITION BY pp.idUser
                    ORDER BY pp.dateStart ASC
                ) AS rn
            FROM PurchasedProducts pp
            LEFT JOIN Products p ON p.id = pp.idProduct
            WHERE pp.status = 'succeeded'
              AND p.\`type\` LIKE 'main%'
        ) x
        WHERE rn = 1
    ),
    max_date_end AS (
        SELECT
            pp.idUser,
            MAX(pp.dateEnd) AS maxDateEnd
        FROM PurchasedProducts pp
        INNER JOIN Products p ON p.id = pp.idProduct
        WHERE pp.status = 'succeeded'
          AND (
                p.\`type\` LIKE 'main%'
             OR p.\`type\` LIKE 'sponsor%'
          )
        GROUP BY pp.idUser
    ),
    periodo_atual AS (
        SELECT
            CASE
                WHEN DAY(NOW()) > 7 THEN
                    TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                ELSE
                    TIMESTAMP(
                        DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                        '00:00:00'
                    )
            END AS dia_7_anterior,
            CASE
                WHEN DAY(NOW()) <= 7 THEN
                    TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                ELSE
                    TIMESTAMP(
                        DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                        '00:00:00'
                    )
            END AS proximo_dia_7
    ),
    base_final AS (
        SELECT
            rm.idUserPayer,
            b.idUser,
            u.idUserParent,
            CASE
                WHEN fp.dateStart IS NULL THEN rm.amount
                WHEN
                    DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                    >= DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior)
                THEN rm.amount
                ELSE
                    ROUND(
                        rm.amount
                        * (DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1)
                        / NULLIF(DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior), 0),
                        2
                    )
            END AS valorProporcional
        FROM base_payroll b
        LEFT JOIN Users u ON u.id = b.idUser
        LEFT JOIN recurring_main rm ON rm.idUser = b.idUser
        LEFT JOIN first_purchase fp ON fp.idUser = b.idUser
        LEFT JOIN max_date_end mde ON mde.idUser = b.idUser
        CROSS JOIN periodo_atual pa
        WHERE u.internalUser = 0
          AND u.status = 'enabled'
          AND (
                u.idUserParent IS NOT NULL
                OR (
                    u.idUserParent IS NULL
                    AND (mde.maxDateEnd IS NULL OR mde.maxDateEnd <= TIMESTAMP(
                        DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-07'),
                        '03:00:00'
                    ))
                )
              )
          ${requireSimCard ? `AND EXISTS (
                SELECT 1
                FROM SimCards sc
                WHERE sc.idUser = b.idUser
                  AND sc.idStatus NOT IN (22,3,18,8,9,14)
            )` : ''}
    )
    SELECT
        COUNT(*) AS totalLinhas,
        SUM(valorProporcional) AS receitaPotencial,
        ROUND(AVG(valorProporcional), 2) AS ticketMedio,
        SUM(CASE WHEN idUserParent IS NULL THEN 1 ELSE 0 END) AS titulares,
        SUM(CASE WHEN idUserParent IS NOT NULL THEN 1 ELSE 0 END) AS dependentes,
        SUM(CASE WHEN idUserParent IS NULL THEN valorProporcional ELSE 0 END) AS receitaTitulares,
        SUM(CASE WHEN idUserParent IS NOT NULL THEN valorProporcional ELSE 0 END) AS receitaDependentes,
        ROUND(AVG(CASE WHEN idUserParent IS NULL THEN valorProporcional END), 2) AS ticketMedioTitulares,
        ROUND(AVG(CASE WHEN idUserParent IS NOT NULL THEN valorProporcional END), 2) AS ticketMedioDependentes
    FROM base_final
  `;
}

apiRouter.get('/api/dashboard', async (req, res) => {
  try {
    const cutoff = "AND u.cdate < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-20'), INTERVAL 1 DAY)";

    const [[cobranca], [total], [todos]] = await Promise.all([
      pool.query(buildDashboardQuery(cutoff)),
      pool.query(buildDashboardQuery('')),
      pool.query(buildDashboardQuery('', { requireSimCard: false })),
    ]);

    res.json({ cobranca: cobranca[0], total: total[0], todos: todos[0] });
  } catch (err) {
    console.error('Dashboard query error:', err);
    res.status(500).json({ error: 'Erro ao consultar dados do dashboard' });
  }
});

// Cobrança agrupada por pagador (idUserPayer)
apiRouter.get('/api/users/payers', async (req, res) => {
  try {
    const view = req.query.view || 'cobranca';
    const cutoffFilter = view === 'cobranca'
      ? "AND u.cdate < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-20'), INTERVAL 1 DAY)"
      : '';

    const [rows] = await pool.query(`
      WITH base_payroll AS (
          SELECT DISTINCT rpc.idUser
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Users u ON u.id = rpc.idUser
          LEFT JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.paymentMethod = 'payroll'
            AND rpc.idStatus = 1
            AND u.status = 'enabled'
            AND u.internalUser = 0
            AND p.\`type\` = 'main'
            ${cutoffFilter}
      ),
      recurring_main AS (
          SELECT *
          FROM (
              SELECT
                  rpc.idProduct,
                  rpc.idUser,
                  rpc.idUserPayer,
                  rpc.amount,
                  rpc.paymentMethod,
                  rpc.idCompany,
                  rpc.cdate,
                  ROW_NUMBER() OVER (
                      PARTITION BY rpc.idUser
                      ORDER BY rpc.cdate DESC
                  ) AS rn
              FROM RecurringPurchasesConfig rpc
              LEFT JOIN Products p ON p.id = rpc.idProduct
              WHERE p.\`type\` LIKE 'main%'
                AND rpc.idStatus = 1
                AND rpc.paymentMethod = 'payroll'
          ) x
          WHERE rn = 1
      ),
      first_purchase AS (
          SELECT *
          FROM (
              SELECT
                  pp.idUser,
                  pp.dateStart,
                  ROW_NUMBER() OVER (
                      PARTITION BY pp.idUser
                      ORDER BY pp.dateStart ASC
                  ) AS rn
              FROM PurchasedProducts pp
              LEFT JOIN Products p ON p.id = pp.idProduct
              WHERE pp.status = 'succeeded'
                AND p.\`type\` LIKE 'main%'
          ) x
          WHERE rn = 1
      ),
      max_date_end AS (
          SELECT
              pp.idUser,
              MAX(pp.dateEnd) AS maxDateEnd
          FROM PurchasedProducts pp
          INNER JOIN Products p ON p.id = pp.idProduct
          WHERE pp.status = 'succeeded'
            AND (
                  p.\`type\` LIKE 'main%'
               OR p.\`type\` LIKE 'sponsor%'
            )
          GROUP BY pp.idUser
      ),
      periodo_atual AS (
          SELECT
              CASE
                  WHEN DAY(NOW()) > 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS dia_7_anterior,
              CASE
                  WHEN DAY(NOW()) <= 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS proximo_dia_7
      ),
      base_final AS (
          SELECT
              rm.idUserPayer,
              CASE
                  WHEN u.idUserParent IS NOT NULL THEN 1
                  WHEN mde.maxDateEnd IS NULL THEN 1
                  WHEN mde.maxDateEnd <= TIMESTAMP(
                      DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-07'),
                      '03:00:00'
                  ) THEN 1
                  ELSE 0
              END AS dentroCobranca,
              CASE
                  WHEN fp.dateStart IS NULL THEN rm.amount
                  WHEN
                      DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                      >= DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior)
                  THEN rm.amount
                  ELSE
                      ROUND(
                          rm.amount
                          * (DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1)
                          / NULLIF(DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior), 0),
                          2
                      )
              END AS valorProporcional
          FROM base_payroll b
          LEFT JOIN Users u ON u.id = b.idUser
          LEFT JOIN recurring_main rm ON rm.idUser = b.idUser
          LEFT JOIN first_purchase fp ON fp.idUser = b.idUser
          LEFT JOIN max_date_end mde ON mde.idUser = b.idUser
          CROSS JOIN periodo_atual pa
          WHERE u.internalUser = 0
            AND u.status = 'enabled'
            AND EXISTS (
                  SELECT 1
                  FROM SimCards sc
                  WHERE sc.idUser = b.idUser
                    AND sc.idStatus NOT IN (22,3,18,8,9,14)
              )
      )
      SELECT
          u.id AS idUser,
          u.name,
          u.cpf,
          SUM(CASE WHEN bf.dentroCobranca = 1 THEN bf.valorProporcional ELSE 0 END) AS valorTotalFolha,
          SUM(bf.dentroCobranca) AS totalLinhas,
          COUNT(*) AS totalLinhasCobraveis
      FROM base_final bf
      LEFT JOIN Users u ON u.id = bf.idUserPayer
      GROUP BY bf.idUserPayer
      ORDER BY SUM(bf.dentroCobranca) DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Payers query error:', err);
    res.status(500).json({ error: 'Erro ao consultar dados por pagador' });
  }
});

// Exportar cobrança do mês como XLSX (mesmo formato da planilha manual)
apiRouter.get('/api/users/payers/export', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH base_payroll AS (
          SELECT DISTINCT rpc.idUser
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Users u ON u.id = rpc.idUser
          LEFT JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.paymentMethod = 'payroll'
            AND rpc.idStatus = 1
            AND u.status = 'enabled'
            AND u.internalUser = 0
            AND p.\`type\` = 'main'
            AND u.cdate < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-20'), INTERVAL 1 DAY)
      ),
      recurring_main AS (
          SELECT *
          FROM (
              SELECT
                  rpc.idProduct,
                  rpc.idUser,
                  rpc.idUserPayer,
                  rpc.amount,
                  rpc.paymentMethod,
                  rpc.idCompany,
                  rpc.cdate,
                  ROW_NUMBER() OVER (
                      PARTITION BY rpc.idUser
                      ORDER BY rpc.cdate DESC
                  ) AS rn
              FROM RecurringPurchasesConfig rpc
              LEFT JOIN Products p ON p.id = rpc.idProduct
              WHERE p.\`type\` LIKE 'main%'
                AND rpc.idStatus = 1
                AND rpc.paymentMethod = 'payroll'
          ) x
          WHERE rn = 1
      ),
      first_purchase AS (
          SELECT *
          FROM (
              SELECT
                  pp.idUser,
                  pp.dateStart,
                  ROW_NUMBER() OVER (
                      PARTITION BY pp.idUser
                      ORDER BY pp.dateStart ASC
                  ) AS rn
              FROM PurchasedProducts pp
              LEFT JOIN Products p ON p.id = pp.idProduct
              WHERE pp.status = 'succeeded'
                AND p.\`type\` LIKE 'main%'
          ) x
          WHERE rn = 1
      ),
      max_date_end AS (
          SELECT
              pp.idUser,
              MAX(pp.dateEnd) AS maxDateEnd
          FROM PurchasedProducts pp
          INNER JOIN Products p ON p.id = pp.idProduct
          WHERE pp.status = 'succeeded'
            AND (
                  p.\`type\` LIKE 'main%'
               OR p.\`type\` LIKE 'sponsor%'
            )
          GROUP BY pp.idUser
      ),
      periodo_atual AS (
          SELECT
              CASE
                  WHEN DAY(NOW()) > 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS dia_7_anterior,
              CASE
                  WHEN DAY(NOW()) <= 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS proximo_dia_7
      ),
      base_final AS (
          SELECT
              rm.idUserPayer,
              CASE
                  WHEN fp.dateStart IS NULL THEN rm.amount
                  WHEN
                      DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                      >= DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior)
                  THEN rm.amount
                  ELSE
                      ROUND(
                          rm.amount
                          * (DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1)
                          / NULLIF(DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior), 0),
                          2
                      )
              END AS valorProporcional
          FROM base_payroll b
          LEFT JOIN Users u ON u.id = b.idUser
          LEFT JOIN recurring_main rm ON rm.idUser = b.idUser
          LEFT JOIN first_purchase fp ON fp.idUser = b.idUser
          LEFT JOIN max_date_end mde ON mde.idUser = b.idUser
          CROSS JOIN periodo_atual pa
          WHERE u.internalUser = 0
            AND u.status = 'enabled'
            AND (
                  u.idUserParent IS NOT NULL
                  OR (
                      u.idUserParent IS NULL
                      AND (mde.maxDateEnd IS NULL OR mde.maxDateEnd <= TIMESTAMP(
                          DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '03:00:00'
                      ))
                  )
                )
            AND EXISTS (
                  SELECT 1
                  FROM SimCards sc
                  WHERE sc.idUser = b.idUser
                    AND sc.idStatus NOT IN (22,3,18,8,9,14)
              )
      )
      SELECT
          u.name,
          u.cpf,
          SUM(bf.valorProporcional) AS valorTotalFolha
      FROM base_final bf
      LEFT JOIN Users u ON u.id = bf.idUserPayer
      GROUP BY bf.idUserPayer
      ORDER BY u.name ASC
    `);

    // Build XLSX matching the manual spreadsheet format
    const now = new Date();
    const monthNames = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const monthLabel = monthNames[now.getMonth()];
    const year = now.getFullYear();

    const data = [
      [null, null, null, null],
      [null, null, null, null],
      [null, 'Nome', 'CPF', 'Valor a ser descontado'],
    ];

    rows.forEach(r => {
      const valor = Number(r.valorTotalFolha) || 0;
      const formatted = 'R$ ' + valor.toFixed(2).replace('.', ',');
      data.push([null, r.name || '', r.cpf || '', formatted]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 2 },
      { wch: 50 },
      { wch: 16 },
      { wch: 24 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Página1');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `Cobranca-TaOn_${monthLabel}-${year}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('Export XLSX error:', err);
    res.status(500).json({ error: 'Erro ao gerar XLSX' });
  }
});

// Lista completa de usuários na base de cobrança
apiRouter.get('/api/users', async (req, res) => {
  try {
    const view = req.query.view || 'cobranca';
    const isTodos = view === 'todos';
    const cutoffFilter = view === 'total' || isTodos
      ? ''
      : "AND u.cdate < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-20'), INTERVAL 1 DAY)";

    const [rows] = await pool.query(`
      WITH base_payroll AS (
          SELECT DISTINCT rpc.idUser
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Users u ON u.id = rpc.idUser
          LEFT JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.paymentMethod = 'payroll'
            AND rpc.idStatus = 1
            AND u.status = 'enabled'
            AND u.internalUser = 0
            AND p.\`type\` = 'main'
            ${cutoffFilter}
      ),
      recurring_main AS (
          SELECT *
          FROM (
              SELECT
                  rpc.idProduct,
                  rpcs.name AS status,
                  rpc.idStatus,
                  rpc.idUser,
                  rpc.amount,
                  rpc.paymentMethod,
                  rpc.idCompany,
                  rpc.cdate,
                  ROW_NUMBER() OVER (
                      PARTITION BY rpc.idUser
                      ORDER BY rpc.cdate DESC
                  ) AS rn
              FROM RecurringPurchasesConfig rpc
              LEFT JOIN Products p ON p.id = rpc.idProduct
              LEFT JOIN RecurringPurchasesConfigStatus rpcs ON rpcs.id = rpc.idStatus
              WHERE p.\`type\` LIKE 'main%'
                AND rpc.idStatus = 1
                AND rpc.paymentMethod = 'payroll'
          ) x
          WHERE rn = 1
      ),
      first_purchase AS (
          SELECT *
          FROM (
              SELECT
                  pp.idUser,
                  pp.idProduct,
                  p.name AS productName,
                  pp.dateStart,
                  ROW_NUMBER() OVER (
                      PARTITION BY pp.idUser
                      ORDER BY pp.dateStart ASC
                  ) AS rn
              FROM PurchasedProducts pp
              LEFT JOIN Products p ON p.id = pp.idProduct
              WHERE pp.status = 'succeeded'
                AND p.\`type\` LIKE 'main%'
          ) x
          WHERE rn = 1
      ),
      max_date_end AS (
          SELECT
              pp.idUser,
              MAX(pp.dateEnd) AS maxDateEnd
          FROM PurchasedProducts pp
          INNER JOIN Products p ON p.id = pp.idProduct
          WHERE pp.status = 'succeeded'
            AND (
                  p.\`type\` LIKE 'main%'
               OR p.\`type\` LIKE 'sponsor%'
            )
          GROUP BY pp.idUser
      ),
      periodo_atual AS (
          SELECT
              CASE
                  WHEN DAY(NOW()) > 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS dia_7_anterior,
              CASE
                  WHEN DAY(NOW()) <= 7 THEN
                      TIMESTAMP(DATE_FORMAT(NOW(), '%Y-%m-07'), '00:00:00')
                  ELSE
                      TIMESTAMP(
                          DATE_FORMAT(DATE_ADD(NOW(), INTERVAL 1 MONTH), '%Y-%m-07'),
                          '00:00:00'
                      )
              END AS proximo_dia_7
      )
      SELECT
          b.idUser,
          u.name,
          u.cpf,
          CASE
              WHEN u.idUserParent IS NULL THEN 'Titular'
              ELSE 'Dependente'
          END AS tipo,
          (
              SELECT mc.mgmInvCode
              FROM MgmChain mc
              WHERE mc.idUser = b.idUser
                AND mc.nivel = 1
              LIMIT 1
          ) AS codigo,
          u.cdate AS dataCadastro,
          COALESCE(p2.name, 'Sem assinatura recorrente') AS assinaturaRecorrente,
          COALESCE(rm.status, 'Sem assinatura recorrente') AS statusRecorrencia,
          COALESCE(rm.amount, NULL) AS valorRecorrencia,
          COALESCE(rm.paymentMethod, 'Sem assinatura recorrente') AS meioPagamento,
          COALESCE(fp.productName, 'Nunca teve assinatura') AS primeiraAssinatura,
          fp.dateStart AS inicioPrimeiraAssinatura,
          rm.idCompany,
          c.companyName,
          mde.maxDateEnd,
          CASE
              WHEN fp.dateStart IS NULL THEN NULL
              WHEN
                  DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                  >= DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior)
              THEN 'Mes completo'
              ELSE
                  CAST(
                      DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                      AS CHAR
                  )
          END AS diasDeUso,
          CASE
              WHEN fp.dateStart IS NULL THEN rm.amount
              WHEN
                  DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1
                  >= DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior)
              THEN rm.amount
              ELSE
                  ROUND(
                      rm.amount
                      * (DATEDIFF(pa.proximo_dia_7, DATE(fp.dateStart)) + 1)
                      / NULLIF(DATEDIFF(pa.proximo_dia_7, pa.dia_7_anterior), 0),
                      2
                  )
          END AS valorProporcional,
          COALESCE(
              (SELECT sc.id FROM SimCards sc WHERE sc.idUser = b.idUser AND sc.idStatus NOT IN (22,3,18,8,9,14) LIMIT 1),
              NULL
          ) AS idSimCard,
          CASE
              WHEN EXISTS (SELECT 1 FROM SimCards sc WHERE sc.idUser = b.idUser AND sc.idStatus NOT IN (22,3,18,8,9,14))
                  THEN 'Sim'
              WHEN EXISTS (SELECT 1 FROM SimCards sc WHERE sc.idUser = b.idUser)
                  THEN 'Inativo'
              ELSE 'Sem chip'
          END AS statusSimCard
      FROM base_payroll b
      LEFT JOIN Users u ON u.id = b.idUser
      LEFT JOIN recurring_main rm ON rm.idUser = b.idUser
      LEFT JOIN Products p2 ON p2.id = rm.idProduct
      LEFT JOIN first_purchase fp ON fp.idUser = b.idUser
      LEFT JOIN max_date_end mde ON mde.idUser = b.idUser
      LEFT JOIN Company c ON c.id = rm.idCompany
      CROSS JOIN periodo_atual pa
      WHERE u.internalUser = 0
        AND u.status = 'enabled'
        AND (
              u.idUserParent IS NOT NULL
              OR (
                  u.idUserParent IS NULL
                  AND (mde.maxDateEnd IS NULL OR mde.maxDateEnd <= TIMESTAMP(
                      DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-07'),
                      '03:00:00'
                  ))
              )
            )
        ${isTodos ? '' : `AND EXISTS (
              SELECT 1
              FROM SimCards sc
              WHERE sc.idUser = b.idUser
                AND sc.idStatus NOT IN (22,3,18,8,9,14)
            )`}
      ORDER BY u.cdate DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('Users query error:', err);
    res.status(500).json({ error: 'Erro ao consultar lista de usuários' });
  }
});

// Novas ativações por dia — aceita ?month=YYYY-MM
apiRouter.get('/api/activations', async (req, res) => {
  try {
    const month = req.query.month; // YYYY-MM
    let dateFilter = '';
    let params = [];

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      dateFilter = 'AND DATE(first_payroll.cdate) >= ? AND DATE(first_payroll.cdate) < DATE_ADD(?, INTERVAL 1 MONTH)';
      const startDate = `${month}-01`;
      params = [startDate, startDate];
    } else {
      // Default: último mês
      dateFilter = 'AND DATE(first_payroll.cdate) >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), \'%Y-%m-01\') AND DATE(first_payroll.cdate) < DATE_FORMAT(CURDATE(), \'%Y-%m-01\')';
    }

    const [summary] = await pool.query(`
      WITH first_payroll AS (
        SELECT
          rpc.idUser,
          MIN(rpc.cdate) AS cdate
        FROM RecurringPurchasesConfig rpc
        INNER JOIN Products p ON p.id = rpc.idProduct
        WHERE rpc.paymentMethod = 'payroll'
          AND rpc.idStatus = 1
          AND p.\`type\` LIKE 'main%'
        GROUP BY rpc.idUser
      )
      SELECT
        DATE_FORMAT(first_payroll.cdate, '%Y-%m-%d') AS dia,
        COUNT(*) AS total,
        SUM(CASE WHEN u.idUserParent IS NULL THEN 1 ELSE 0 END) AS titulares,
        SUM(CASE WHEN u.idUserParent IS NOT NULL THEN 1 ELSE 0 END) AS dependentes
      FROM first_payroll
      INNER JOIN Users u ON u.id = first_payroll.idUser
      WHERE u.internalUser = 0
        ${dateFilter}
      GROUP BY DATE(first_payroll.cdate)
      ORDER BY dia ASC
    `, params);

    res.json(summary);
  } catch (err) {
    console.error('Activations query error:', err);
    res.status(500).json({ error: 'Erro ao consultar ativações' });
  }
});

// Detalhes dos ativados em um dia específico — ?date=YYYY-MM-DD
apiRouter.get('/api/activations/details', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Parâmetro date obrigatório (YYYY-MM-DD)' });
    }

    const [rows] = await pool.query(`
      WITH first_payroll AS (
        SELECT
          rpc.idUser,
          MIN(rpc.cdate) AS cdate
        FROM RecurringPurchasesConfig rpc
        INNER JOIN Products p ON p.id = rpc.idProduct
        WHERE rpc.paymentMethod = 'payroll'
          AND rpc.idStatus = 1
          AND p.\`type\` LIKE 'main%'
        GROUP BY rpc.idUser
      ),
      latest_config AS (
        SELECT *
        FROM (
          SELECT
            rpc.idUser,
            rpc.amount,
            rpc.idCompany,
            ROW_NUMBER() OVER (PARTITION BY rpc.idUser ORDER BY rpc.cdate DESC) AS rn
          FROM RecurringPurchasesConfig rpc
          INNER JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.paymentMethod = 'payroll'
            AND rpc.idStatus = 1
            AND p.\`type\` LIKE 'main%'
        ) x WHERE rn = 1
      )
      SELECT
        u.id AS idUser,
        u.name,
        u.cpf,
        u.email,
        CASE WHEN u.idUserParent IS NULL THEN 'Titular' ELSE 'Dependente' END AS tipo,
        (
          SELECT mc.mgmInvCode
          FROM MgmChain mc
          WHERE mc.idUser = first_payroll.idUser
            AND mc.nivel = 1
          LIMIT 1
        ) AS codigo,
        lc.amount,
        lc.idCompany,
        c.companyName,
        first_payroll.cdate AS dataAtivacao
      FROM first_payroll
      INNER JOIN Users u ON u.id = first_payroll.idUser
      INNER JOIN latest_config lc ON lc.idUser = first_payroll.idUser
      LEFT JOIN Company c ON c.id = lc.idCompany
      WHERE u.internalUser = 0
        AND DATE(first_payroll.cdate) = ?
      ORDER BY first_payroll.cdate ASC
    `, [date]);

    res.json(rows);
  } catch (err) {
    console.error('Activation details query error:', err);
    res.status(500).json({ error: 'Erro ao consultar detalhes' });
  }
});

// Parcerias Gigu / StopClub
apiRouter.get('/api/partnerships', async (req, res) => {
  try {
    const month = req.query.month; // YYYY-MM
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Parâmetro month obrigatório (YYYY-MM)' });
    }

    const startDate = `${month}-01 00:00:00`;

    const giguCodes = `(vmrc.Codigo LIKE '%GIGU%')`;
    const stopclubCodes = `(vmrc.Codigo LIKE '%SC2%' OR vmrc.Codigo LIKE '%STOPCLUB%' OR vmrc.Codigo LIKE 'MOTORISTASC' OR vmrc.Codigo LIKE '%SC50%')`;

    const buildQuery = (codesFilter) => `
      SELECT
          lp.iduser,
          u.nickname,
          lp.last_product,
          lp.last_date,
          lp.last_amount,
          CASE
              WHEN DATE_FORMAT(lp.last_date, '%Y-%m') = DATE_FORMAT(fp.first_date, '%Y-%m') THEN 'Ativação'
              ELSE 'Recorrência'
          END AS tipo,
          fp.first_date,
          fp.first_amount
      FROM (
          SELECT
              pp.idUser,
              MAX(pp.dateStart) AS last_date,
              pp.purchasedAmount AS last_amount,
              p.name AS last_product
          FROM PurchasedProducts pp
          LEFT JOIN vwbiMgmRefCanal vmrc ON pp.idUser = vmrc.idUser
          LEFT JOIN Products p ON p.id = pp.idProduct
          WHERE ${codesFilter}
            AND pp.status = 'succeeded'
            AND pp.dateStart >= ?
            AND pp.dateStart < DATE_ADD(?, INTERVAL 1 MONTH)
            AND pp.purchasedAmount > 0
            AND p.\`type\` = 'main'
          GROUP BY pp.idUser
      ) AS lp
      LEFT JOIN (
          SELECT
              pp.idUser,
              MIN(pp.cdate) AS first_date,
              pp.purchasedAmount AS first_amount
          FROM PurchasedProducts pp
          LEFT JOIN vwbiMgmRefCanal vmrc ON pp.idUser = vmrc.idUser
          WHERE ${codesFilter}
            AND pp.status = 'succeeded'
          GROUP BY pp.idUser
      ) AS fp ON fp.idUser = lp.idUser
      LEFT JOIN Users u ON u.id = lp.idUser
      WHERE TIMESTAMPDIFF(MONTH, fp.first_date, lp.last_date) <= 5
      ORDER BY lp.last_date ASC
    `;

    const [[giguRows], [stopclubRows]] = await Promise.all([
      pool.query(buildQuery(giguCodes), [startDate, startDate]),
      pool.query(buildQuery(stopclubCodes), [startDate, startDate]),
    ]);

    const calcRepasse = (amount, tipo) => {
      if (amount === 55) return 5.00;
      return tipo === 'Ativação'
        ? Math.round(amount * 0.15 * 100) / 100
        : Math.round(amount * 0.10 * 100) / 100;
    };

    const enrich = (rows) => rows.map(r => ({
      ...r,
      repasse: calcRepasse(Number(r.last_amount), r.tipo),
    }));

    const giguData = enrich(giguRows);
    const stopclubData = enrich(stopclubRows);

    const sum = (arr) => Math.round(arr.reduce((s, r) => s + r.repasse, 0) * 100) / 100;

    res.json({
      gigu: giguData,
      stopclub: stopclubData,
      giguTotal: sum(giguData),
      stopclubTotal: sum(stopclubData),
      total: sum([...giguData, ...stopclubData]),
    });
  } catch (err) {
    console.error('Partnerships query error:', err);
    res.status(500).json({ error: 'Erro ao consultar parcerias' });
  }
});

// Ativação Meli — métricas de usuários com código MELI26
apiRouter.get('/api/meli/summary', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      ),
      user_data AS (
        SELECT
          u.id AS idUser,
          u.name,
          u.cpf,
          u.cdate,
          u.status,
          u.idUserParent,
          CASE WHEN u.idUserParent IS NULL THEN 'Titular' ELSE 'Dependente' END AS tipo
        FROM meli_users mu
        INNER JOIN Users u ON u.id = mu.idUser
        WHERE u.internalUser = 0
      ),
      with_subscription AS (
        SELECT
          ud.*,
          rpc.amount,
          rpc.paymentMethod,
          rpc.idCompany,
          rpc.idStatus AS rpcStatus,
          p.name AS productName,
          c.companyName,
          ROW_NUMBER() OVER (PARTITION BY ud.idUser ORDER BY rpc.cdate DESC) AS rn
        FROM user_data ud
        INNER JOIN RecurringPurchasesConfig rpc ON rpc.idUser = ud.idUser
        LEFT JOIN Products p ON p.id = rpc.idProduct
        LEFT JOIN Company c ON c.id = rpc.idCompany
        WHERE rpc.idStatus = 1
      )
      SELECT
        (SELECT COUNT(*) FROM user_data) AS totalCadastrados,
        (SELECT SUM(CASE WHEN idUserParent IS NULL THEN 1 ELSE 0 END) FROM user_data) AS titularesCadastrados,
        (SELECT SUM(CASE WHEN idUserParent IS NOT NULL THEN 1 ELSE 0 END) FROM user_data) AS dependentesCadastrados,
        (SELECT COUNT(*) FROM user_data WHERE status = 'enabled') AS totalAtivos,
        (SELECT SUM(CASE WHEN status = 'enabled' AND idUserParent IS NULL THEN 1 ELSE 0 END) FROM user_data) AS titularesAtivos,
        (SELECT SUM(CASE WHEN status = 'enabled' AND idUserParent IS NOT NULL THEN 1 ELSE 0 END) FROM user_data) AS dependentesAtivos,
        COUNT(*) AS totalComAssinatura,
        SUM(CASE WHEN tipo = 'Titular' THEN 1 ELSE 0 END) AS titularesAssinatura,
        SUM(CASE WHEN tipo = 'Dependente' THEN 1 ELSE 0 END) AS dependentesAssinatura,
        COALESCE(SUM(amount), 0) AS receitaTotal,
        ROUND(COALESCE(AVG(amount), 0), 2) AS ticketMedio,
        (SELECT COUNT(*) FROM SimCards sc INNER JOIN user_data ud2 ON ud2.idUser = sc.idUser) AS totalChips,
        (SELECT COUNT(*) FROM SimCards sc INNER JOIN user_data ud2 ON ud2.idUser = sc.idUser WHERE sc.type = 'fisico') AS chipsFisicos,
        (SELECT COUNT(*) FROM SimCards sc INNER JOIN user_data ud2 ON ud2.idUser = sc.idUser WHERE sc.type = 'e-sim') AS chipsEsim,
        (SELECT COUNT(DISTINCT sc2.imsi) FROM SimCards sc2 INNER JOIN user_data ud3 ON ud3.idUser = sc2.idUser WHERE EXISTS (SELECT 1 FROM IPsUsers ip WHERE ip.imsi = sc2.imsi) OR EXISTS (SELECT 1 FROM IPsIMSIsTemp ipt WHERE ipt.imsi = sc2.imsi)) AS chipsApn
      FROM with_subscription
      WHERE rn = 1
    `);

    res.json(rows[0]);
  } catch (err) {
    console.error('Meli summary error:', err);
    res.status(500).json({ error: 'Erro ao consultar métricas Meli' });
  }
});

// Chips que bateram na APN (detalhamento)
apiRouter.get('/api/meli/apn', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      )
      SELECT
        u.id AS idUser,
        sc.imsi,
        ipu.ipUser,
        DATE_FORMAT(DATE_SUB(ipu.ipUserDate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS ipUserDate,
        ipt.ipTemp,
        ipt.ipTempStatus,
        DATE_FORMAT(DATE_SUB(ipt.ipTempDate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS ipTempDate
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      INNER JOIN SimCards sc ON sc.idUser = u.id
      LEFT JOIN (
        SELECT i1.imsi, i1.IPv4Suffix AS ipUser, i1.cdate AS ipUserDate
        FROM IPsUsers i1
        INNER JOIN (SELECT imsi, MAX(id) AS maxId FROM IPsUsers GROUP BY imsi) i2 ON i1.id = i2.maxId
      ) ipu ON ipu.imsi = sc.imsi
      LEFT JOIN (
        SELECT i1.imsi, i1.IPv4Suffix AS ipTemp, i1.status AS ipTempStatus, i1.cdate AS ipTempDate
        FROM IPsIMSIsTemp i1
        INNER JOIN (SELECT imsi, MAX(id) AS maxId FROM IPsIMSIsTemp GROUP BY imsi) i2 ON i1.id = i2.maxId
      ) ipt ON ipt.imsi = sc.imsi
      WHERE u.internalUser = 0
        AND (ipu.imsi IS NOT NULL OR ipt.imsi IS NOT NULL)
      ORDER BY GREATEST(COALESCE(ipu.ipUserDate, '1970-01-01'), COALESCE(ipt.ipTempDate, '1970-01-01')) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Meli APN error:', err);
    res.status(500).json({ error: 'Erro ao consultar dados APN' });
  }
});

// Chips que NAO bateram na APN
apiRouter.get('/api/meli/nao-apn', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      )
      SELECT
        u.id AS idUser,
        sc.imsi,
        sc.iccid,
        sc.type AS tipoChip,
        CASE sc.idStatus WHEN 1 THEN 'Ativo' WHEN 2 THEN 'Inativo' ELSE CONCAT('Status ', sc.idStatus) END AS statusChip
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      INNER JOIN SimCards sc ON sc.idUser = u.id
      WHERE u.internalUser = 0
        AND NOT EXISTS (SELECT 1 FROM IPsUsers ip WHERE ip.imsi = sc.imsi)
        AND NOT EXISTS (SELECT 1 FROM IPsIMSIsTemp ipt WHERE ipt.imsi = sc.imsi)
      ORDER BY u.id, sc.imsi
    `);
    res.json(rows);
  } catch (err) {
    console.error('Meli nao-apn error:', err);
    res.status(500).json({ error: 'Erro ao consultar chips sem APN' });
  }
});

// Todos os chips associados (com info APN)
apiRouter.get('/api/meli/chips', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      )
      SELECT
        u.id AS idUser,
        sc.imsi,
        sc.iccid,
        sc.type AS tipoChip,
        CASE sc.idStatus WHEN 1 THEN 'Ativo' WHEN 2 THEN 'Inativo' ELSE CONCAT('Status ', sc.idStatus) END AS statusChip,
        DATE_FORMAT(DATE_SUB(sc.cdate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS dataAssociacao,
        DATE_FORMAT(DATE_SUB(apn.primeiraApn, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS primeiraApn,
        DATE_FORMAT(DATE_SUB(apn.ultimaApn, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS ultimaApn,
        apn.totalSessoes,
        ipu.IPv4Suffix AS ipUser,
        DATE_FORMAT(DATE_SUB(ipu.cdate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS ipUserDate,
        ipt.IPv4Suffix AS ipTemp,
        ipt.status AS ipTempStatus,
        DATE_FORMAT(DATE_SUB(ipt.cdate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS ipTempDate
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      INNER JOIN SimCards sc ON sc.idUser = u.id
      LEFT JOIN (
        SELECT dss.imsi, MIN(dss.cdate) AS primeiraApn, MAX(dss.cdate) AS ultimaApn, COUNT(*) AS totalSessoes
        FROM DataServicesSessions dss
        GROUP BY dss.imsi
      ) apn ON apn.imsi = sc.imsi
      LEFT JOIN (
        SELECT i1.imsi, i1.IPv4Suffix, i1.cdate
        FROM IPsUsers i1
        INNER JOIN (SELECT imsi, MAX(id) AS maxId FROM IPsUsers GROUP BY imsi) i2 ON i1.id = i2.maxId
      ) ipu ON ipu.imsi = sc.imsi
      LEFT JOIN (
        SELECT i1.imsi, i1.IPv4Suffix, i1.status, i1.cdate
        FROM IPsIMSIsTemp i1
        INNER JOIN (SELECT imsi, MAX(id) AS maxId FROM IPsIMSIsTemp GROUP BY imsi) i2 ON i1.id = i2.maxId
      ) ipt ON ipt.imsi = sc.imsi
      WHERE u.internalUser = 0
      ORDER BY u.id, sc.imsi
    `);
    res.json(rows);
  } catch (err) {
    console.error('Meli chips error:', err);
    res.status(500).json({ error: 'Erro ao consultar chips' });
  }
});

// Ativações Meli por dia (timeline com subdivisão por plano)
apiRouter.get('/api/meli/timeline', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      ),
      latest_rpc AS (
        SELECT *
        FROM (
          SELECT
            rpc.idUser,
            p.name AS productName,
            ROW_NUMBER() OVER (PARTITION BY rpc.idUser ORDER BY rpc.cdate DESC) AS rn
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.idStatus = 1
        ) x WHERE rn = 1
      )
      SELECT
        DATE_FORMAT(u.cdate, '%Y-%m-%d') AS dia,
        COALESCE(lr.productName, 'Sem plano') AS plano,
        COUNT(*) AS total
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      LEFT JOIN latest_rpc lr ON lr.idUser = u.id
      WHERE u.internalUser = 0
        ${req.query.month ? "AND DATE_FORMAT(u.cdate, '%Y-%m') = ?" : ''}
      GROUP BY DATE_FORMAT(u.cdate, '%Y-%m-%d'), COALESCE(lr.productName, 'Sem plano')
      ORDER BY dia ASC, plano ASC
    `, req.query.month ? [req.query.month] : []);

    res.json(rows);
  } catch (err) {
    console.error('Meli timeline error:', err);
    res.status(500).json({ error: 'Erro ao consultar timeline Meli' });
  }
});


// Chips Meli por dia (timeline físico vs eSIM)
apiRouter.get('/api/meli/chips-timeline', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      )
      SELECT
        DATE_FORMAT(u.cdate, '%Y-%m-%d') AS dia,
        sc.type AS tipoChip,
        COUNT(*) AS total
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      INNER JOIN SimCards sc ON sc.idUser = u.id
      WHERE u.internalUser = 0
        ${req.query.month ? "AND DATE_FORMAT(u.cdate, '%Y-%m') = ?" : ''}
      GROUP BY dia, sc.type
      ORDER BY dia ASC, sc.type ASC
    `, req.query.month ? [req.query.month] : []);

    res.json(rows);
  } catch (err) {
    console.error('Meli chips timeline error:', err);
    res.status(500).json({ error: 'Erro ao consultar timeline de chips' });
  }
});

// Lista de usuários Meli
apiRouter.get('/api/meli/users', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      ),
      latest_rpc AS (
        SELECT *
        FROM (
          SELECT
            rpc.idUser,
            rpc.amount,
            rpc.paymentMethod,
            rpc.idCompany,
            rpc.idStatus,
            rpcs.name AS statusRecorrencia,
            p.name AS productName,
            ROW_NUMBER() OVER (PARTITION BY rpc.idUser ORDER BY rpc.cdate DESC) AS rn
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Products p ON p.id = rpc.idProduct
          LEFT JOIN RecurringPurchasesConfigStatus rpcs ON rpcs.id = rpc.idStatus
        ) x WHERE rn = 1
      )
      SELECT
        u.id AS idUser,
        u.cdate AS dataCadastro,
        u.status,
        CASE WHEN u.idUserParent IS NULL THEN 'Titular' ELSE 'Dependente' END AS tipo,
        lr.amount,
        lr.paymentMethod,
        lr.statusRecorrencia,
        lr.productName,
        c.companyName,
        um.value AS idMotorista,
        ml.level AS nivelBD,
        GROUP_CONCAT(DISTINCT sc.imsi ORDER BY sc.id SEPARATOR ', ') AS imsi,
        GROUP_CONCAT(DISTINCT sc.iccid ORDER BY sc.id SEPARATOR ', ') AS iccid,
        COUNT(DISTINCT sc.id) AS totalChips
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      LEFT JOIN latest_rpc lr ON lr.idUser = u.id
      LEFT JOIN Company c ON c.id = lr.idCompany
      LEFT JOIN UsersMetadata um ON um.idUser = u.id AND um.name = 'identifier'
      LEFT JOIN (
        SELECT m1.identifier, m1.level
        FROM Meli m1
        INNER JOIN (SELECT identifier, MAX(id) AS maxId FROM Meli GROUP BY identifier) m2 ON m1.id = m2.maxId
      ) ml ON ml.identifier = um.value
      LEFT JOIN SimCards sc ON sc.idUser = u.id
      WHERE u.internalUser = 0
      GROUP BY u.id, u.cdate, u.status, u.idUserParent,
        lr.amount, lr.paymentMethod, lr.statusRecorrencia, lr.productName,
        c.companyName, um.value, ml.level
      ORDER BY u.cdate DESC
    `);

    // Enrich with CSV data
    const enriched = rows.map(r => {
      const obj = JSON.parse(JSON.stringify(r));
      const csv = meliCsvMap.get(String(obj.idMotorista)) || {};
      obj.csvLevelName = csv.csvLevelName || null;
      obj.csvMovement = csv.csvMovement || null;
      obj.naBase = csv.csvLevelName ? 'Sim' : 'Nao';
      return obj;
    });

    res.json(enriched);
  } catch (err) {
    console.error('Meli users error:', err);
    res.status(500).json({ error: 'Erro ao consultar usuários Meli' });
  }
});

// Mount API routes at root and under prefix
app.use('/', apiRouter);
app.use(PREFIX, apiRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
