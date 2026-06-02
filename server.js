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
      data.push([null, r.name || '', r.cpf || '', valor]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Format value column as number with 2 decimal places
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = 3; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 3 })];
      if (cell) { cell.t = 'n'; cell.z = '#,##0.00'; }
    }

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
      dateFilter = 'AND DATE(fp.cdate) >= ? AND DATE(fp.cdate) < DATE_ADD(?, INTERVAL 1 MONTH)';
      const startDate = `${month}-01`;
      params = [startDate, startDate];
    } else {
      dateFilter = 'AND DATE(fp.cdate) >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), \'%Y-%m-01\') AND DATE(fp.cdate) < DATE_FORMAT(CURDATE(), \'%Y-%m-01\')';
    }

    const [summary] = await pool.query(`
      WITH hagana_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode IN ('HAGANADFGERAL', 'HAGANADF')
          AND mc.nivel = 1
      ),
      first_payroll AS (
        SELECT
          rpc.idUser,
          MIN(rpc.cdate) AS cdate
        FROM RecurringPurchasesConfig rpc
        INNER JOIN Products p ON p.id = rpc.idProduct
        INNER JOIN hagana_users hu ON hu.idUser = rpc.idUser
        WHERE rpc.paymentMethod = 'payroll'
          AND rpc.idStatus = 1
          AND p.\`type\` LIKE 'main%'
        GROUP BY rpc.idUser
      )
      SELECT
        DATE_FORMAT(fp.cdate, '%Y-%m-%d') AS dia,
        COUNT(*) AS total,
        SUM(CASE WHEN u.idUserParent IS NULL THEN 1 ELSE 0 END) AS titulares,
        SUM(CASE WHEN u.idUserParent IS NOT NULL THEN 1 ELSE 0 END) AS dependentes
      FROM first_payroll fp
      INNER JOIN Users u ON u.id = fp.idUser
      WHERE u.internalUser = 0
        ${dateFilter}
      GROUP BY DATE(fp.cdate)
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
      WITH hagana_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode IN ('HAGANADFGERAL', 'HAGANADF')
          AND mc.nivel = 1
      ),
      first_payroll AS (
        SELECT
          rpc.idUser,
          MIN(rpc.cdate) AS cdate
        FROM RecurringPurchasesConfig rpc
        INNER JOIN Products p ON p.id = rpc.idProduct
        INNER JOIN hagana_users hu ON hu.idUser = rpc.idUser
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
          WHERE mc.idUser = fp.idUser
            AND mc.nivel = 1
          LIMIT 1
        ) AS codigo,
        lc.amount,
        lc.idCompany,
        c.companyName,
        fp.cdate AS dataAtivacao
      FROM first_payroll fp
      INNER JOIN Users u ON u.id = fp.idUser
      INNER JOIN latest_config lc ON lc.idUser = fp.idUser
      LEFT JOIN Company c ON c.id = lc.idCompany
      WHERE u.internalUser = 0
        AND DATE(fp.cdate) = ?
      ORDER BY fp.cdate ASC
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

// Chips detalhados de um spot/company
apiRouter.get('/api/stock/spot-chips', async (req, res) => {
  try {
    const { idCompany, idSpot } = req.query;
    if (!idCompany) return res.json([]);

    const spotFilter = idSpot === '0'
      ? 'AND sc.idSpot IS NULL'
      : idSpot ? 'AND sc.idSpot = ?' : '';
    const params = [idCompany];
    if (idSpot && idSpot !== '0') params.push(idSpot);

    const [rows] = await pool.query(`
      SELECT
        sc.id,
        sc.imsi,
        sc.iccid,
        sc.\`type\` AS tipoChip,
        sc.idStatus,
        sc.idUser,
        u.name AS userName,
        sc.qrcodeEsim,
        DATE_FORMAT(DATE_SUB(sc.vdate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS vdate,
        DATE_FORMAT(DATE_SUB(sc.cdate, INTERVAL 3 HOUR), '%Y-%m-%dT%H:%i:%s') AS cdate
      FROM SimCards sc
      LEFT JOIN Users u ON u.id = sc.idUser
      WHERE sc.idCompany = ? ${spotFilter}
      ORDER BY sc.vdate DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Spot chips error:', err);
    res.status(500).json({ error: 'Erro ao consultar chips do spot' });
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

// Evolução da base Meli entre refDates
apiRouter.get('/api/meli/evolution', async (req, res) => {
  try {
    const refDate = req.query.refDate || null;
    if (!refDate) return res.json({});

    // Calcular refDate anterior
    const y = parseInt(refDate.substring(0, 4));
    const m = parseInt(refDate.substring(4, 6));
    const prevDate = m === 1
      ? `${y - 1}12`
      : `${y}${String(m - 1).padStart(2, '0')}`;

    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      ),
      identifiers AS (
        SELECT mu.idUser, um.value AS identifier
        FROM meli_users mu
        INNER JOIN Users u ON u.id = mu.idUser
        LEFT JOIN UsersMetadata um ON um.idUser = u.id AND um.name = 'identifier'
        WHERE u.internalUser = 0
      ),
      curr AS (
        SELECT DISTINCT identifier FROM Meli WHERE refDate = ?
      ),
      prev AS (
        SELECT DISTINCT identifier FROM Meli WHERE refDate = ?
      )
      SELECT
        COUNT(DISTINCT i.idUser) AS totalUsuarios,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND c.identifier IS NOT NULL THEN i.idUser END) AS naBaseAtual,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND p.identifier IS NOT NULL THEN i.idUser END) AS naBaseAnterior,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND c.identifier IS NOT NULL AND p.identifier IS NOT NULL THEN i.idUser END) AS permaneceramNaBase,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND c.identifier IS NOT NULL AND p.identifier IS NULL THEN i.idUser END) AS entraramNaBase,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND c.identifier IS NULL AND p.identifier IS NOT NULL THEN i.idUser END) AS sairamDaBase,
        COUNT(DISTINCT CASE WHEN i.identifier IS NOT NULL AND c.identifier IS NULL AND p.identifier IS NULL THEN i.idUser END) AS nuncaNaBase,
        COUNT(DISTINCT CASE WHEN i.identifier IS NULL THEN i.idUser END) AS semIdentifier
      FROM identifiers i
      LEFT JOIN curr c ON c.identifier = i.identifier
      LEFT JOIN prev p ON p.identifier = i.identifier
    `, [refDate, prevDate]);

    const r = rows[0];
    r.refDate = refDate;
    r.prevRefDate = prevDate;
    res.json(r);
  } catch (err) {
    console.error('Meli evolution error:', err);
    res.status(500).json({ error: 'Erro ao consultar evolução Meli' });
  }
});

// refDates disponíveis na tabela Meli
apiRouter.get('/api/meli/ref-dates', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT refDate FROM Meli WHERE refDate IS NOT NULL ORDER BY refDate DESC
    `);
    res.json(rows.map(r => r.refDate));
  } catch (err) {
    console.error('Meli ref-dates error:', err);
    res.status(500).json({ error: 'Erro ao consultar refDates' });
  }
});

// Lista de usuários Meli
apiRouter.get('/api/meli/users', async (req, res) => {
  try {
    const refDate = req.query.refDate || null;

    // Calcular refDate anterior
    const y = parseInt(refDate.substring(0, 4));
    const m = parseInt(refDate.substring(4, 6));
    const prevRefDate = m === 1
      ? `${y - 1}12`
      : `${y}${String(m - 1).padStart(2, '0')}`;

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
      ),
      meli_ref AS (
        SELECT identifier, level, moviment, currentLevelNumber, currentLevelName, totalEntries
        FROM (
          SELECT m.*,
            COUNT(*) OVER (PARTITION BY m.identifier) AS totalEntries,
            ROW_NUMBER() OVER (PARTITION BY m.identifier ORDER BY m.id DESC) AS rn
          FROM Meli m
          WHERE m.refDate = ?
        ) x WHERE rn = 1
      ),
      meli_prev AS (
        SELECT identifier, currentLevelName AS prevLevelName
        FROM (
          SELECT m.*,
            ROW_NUMBER() OVER (PARTITION BY m.identifier ORDER BY m.id DESC) AS rn
          FROM Meli m
          WHERE m.refDate = ?
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
        mr.level AS nivelBD,
        mr.currentLevelName AS nivelMeli,
        mr.currentLevelNumber AS nivelNumero,
        mr.moviment AS movimento,
        CASE WHEN mr.identifier IS NOT NULL THEN 'Sim' ELSE 'Nao' END AS naBase,
        CASE WHEN mp.identifier IS NOT NULL THEN 'Sim' ELSE 'Nao' END AS naBaseAnterior,
        mp.prevLevelName,
        CASE
          WHEN um.value IS NULL THEN 'sem-id'
          WHEN mr.identifier IS NOT NULL AND mp.identifier IS NOT NULL THEN 'permaneceu'
          WHEN mr.identifier IS NOT NULL AND mp.identifier IS NULL THEN 'entrou'
          WHEN mr.identifier IS NULL AND mp.identifier IS NOT NULL THEN 'saiu'
          ELSE 'nunca'
        END AS evolucao,
        COALESCE(mr.totalEntries, 0) AS dupCount,
        umChip.value AS getTypeChip,
        GROUP_CONCAT(DISTINCT sc.imsi ORDER BY sc.id SEPARATOR ', ') AS imsi,
        GROUP_CONCAT(DISTINCT sc.iccid ORDER BY sc.id SEPARATOR ', ') AS iccid,
        GROUP_CONCAT(DISTINCT sc.\`type\` ORDER BY sc.id SEPARATOR ', ') AS tipoChip,
        COUNT(DISTINCT sc.id) AS totalChips
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      LEFT JOIN latest_rpc lr ON lr.idUser = u.id
      LEFT JOIN Company c ON c.id = lr.idCompany
      LEFT JOIN UsersMetadata um ON um.idUser = u.id AND um.name = 'identifier'
      LEFT JOIN UsersMetadata umChip ON umChip.idUser = u.id AND umChip.name = 'getTypeChip'
      LEFT JOIN meli_ref mr ON mr.identifier = um.value
      LEFT JOIN meli_prev mp ON mp.identifier = um.value
      LEFT JOIN SimCards sc ON sc.idUser = u.id
      WHERE u.internalUser = 0
      GROUP BY u.id, u.cdate, u.status, u.idUserParent,
        lr.amount, lr.paymentMethod, lr.statusRecorrencia, lr.productName,
        c.companyName, um.value, umChip.value, mr.level, mr.currentLevelName, mr.currentLevelNumber,
        mr.moviment, mr.identifier, mr.totalEntries, mp.identifier, mp.prevLevelName
      ORDER BY u.cdate DESC
    `, [refDate, prevRefDate]);

    res.json(rows);
  } catch (err) {
    console.error('Meli users error:', err);
    res.status(500).json({ error: 'Erro ao consultar usuários Meli' });
  }
});

// Movimentos entre refDates (apenas cadastrados MELI26)
apiRouter.get('/api/meli/movements', async (req, res) => {
  try {
    const refDate = req.query.refDate;
    if (!refDate) return res.json({});

    const y = parseInt(refDate.substring(0, 4));
    const m = parseInt(refDate.substring(4, 6));
    const prevRefDate = m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;

    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26' AND mc.nivel = 1
      ),
      identifiers AS (
        SELECT u.id AS idUser, u.name, u.status, um.value AS identifier
        FROM meli_users mu
        INNER JOIN Users u ON u.id = mu.idUser
        INNER JOIN UsersMetadata um ON um.idUser = u.id AND um.name = 'identifier'
        WHERE u.internalUser = 0
      ),
      curr AS (
        SELECT identifier, currentLevelNumber AS level, currentLevelName AS levelName, moviment AS movement
        FROM (
          SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.identifier ORDER BY m.id DESC) AS rn
          FROM Meli m WHERE m.refDate = ?
        ) x WHERE rn = 1
      ),
      prev AS (
        SELECT identifier, currentLevelNumber AS level, currentLevelName AS levelName, moviment AS movement
        FROM (
          SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.identifier ORDER BY m.id DESC) AS rn
          FROM Meli m WHERE m.refDate = ?
        ) x WHERE rn = 1
      )
      SELECT
        i.idUser, i.name, i.identifier, i.status,
        p.levelName AS prevLevel, p.level AS prevLevelNum, p.movement AS prevMovement,
        c.levelName AS currLevel, c.level AS currLevelNum, c.movement AS currMovement,
        CASE
          WHEN c.identifier IS NOT NULL AND p.identifier IS NOT NULL THEN 'permaneceu'
          WHEN c.identifier IS NOT NULL AND p.identifier IS NULL THEN 'entrou'
          WHEN c.identifier IS NULL AND p.identifier IS NOT NULL THEN 'saiu'
          ELSE 'nenhuma'
        END AS evolucao
      FROM identifiers i
      LEFT JOIN curr c ON c.identifier = i.identifier
      LEFT JOIN prev p ON p.identifier = i.identifier
    `, [refDate, prevRefDate]);

    // Compute stats
    const totalCadastrados = rows.length;
    const permaneceu = rows.filter(r => r.evolucao === 'permaneceu');
    const entrou = rows.filter(r => r.evolucao === 'entrou');
    const saiu = rows.filter(r => r.evolucao === 'saiu');
    const nenhuma = rows.filter(r => r.evolucao === 'nenhuma');
    const naPrev = rows.filter(r => r.prevLevel);
    const naCurr = rows.filter(r => r.currLevel);

    // Level distribution
    const prevLevels = { Silver: 0, Gold: 0, Platinum: 0 };
    const currLevels = { Silver: 0, Gold: 0, Platinum: 0 };
    naPrev.forEach(r => { if (prevLevels[r.prevLevel] !== undefined) prevLevels[r.prevLevel]++; });
    naCurr.forEach(r => { if (currLevels[r.currLevel] !== undefined) currLevels[r.currLevel]++; });

    // Transitions
    const transitions = {};
    let subiram = 0, desceram = 0, mantiveram = 0;
    permaneceu.forEach(r => {
      if (!r.prevLevel || !r.currLevel) return;
      const key = `${r.prevLevel} -> ${r.currLevel}`;
      transitions[key] = (transitions[key] || 0) + 1;
      if (r.currLevelNum > r.prevLevelNum) subiram++;
      else if (r.currLevelNum < r.prevLevelNum) desceram++;
      else mantiveram++;
    });

    // Retention by level
    const retencao = ['Silver', 'Gold', 'Platinum'].map(nivel => {
      const total = naPrev.filter(r => r.prevLevel === nivel).length;
      const ficaram = permaneceu.filter(r => r.prevLevel === nivel).length;
      const perdidos = saiu.filter(r => r.prevLevel === nivel).length;
      return { nivel, total, ficaram, perdidos, pct: total > 0 ? +(ficaram / total * 100).toFixed(1) : 0 };
    });

    // Detail lists
    const sairamDetail = saiu.map(r => ({
      idUser: r.idUser, name: r.name, identifier: r.identifier,
      prevLevel: r.prevLevel, prevMovement: r.prevMovement,
    }));

    const entraramDetail = entrou.map(r => ({
      idUser: r.idUser, name: r.name, identifier: r.identifier,
      currLevel: r.currLevel, currMovement: r.currMovement,
    }));

    res.json({
      refDate,
      prevRefDate,
      totalCadastrados,
      naPrev: naPrev.length,
      naCurr: naCurr.length,
      permaneceram: permaneceu.length,
      entraram: entrou.length,
      sairam: saiu.length,
      nenhumaBase: nenhuma.length,
      prevLevels,
      currLevels,
      movimentos: { subiram, desceram, mantiveram },
      transitions: Object.entries(transitions).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      retencao,
      sairamDetail,
      entraramDetail,
    });
  } catch (err) {
    console.error('Meli movements error:', err);
    res.status(500).json({ error: 'Erro ao consultar movimentos' });
  }
});

// Estoque — lista de companies com chips
apiRouter.get('/api/stock/companies', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sc.idCompany, c.companyName, COUNT(*) AS total
      FROM SimCards sc
      INNER JOIN Company c ON c.id = sc.idCompany
      GROUP BY sc.idCompany
      ORDER BY c.companyName ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Stock companies error:', err);
    res.status(500).json({ error: 'Erro ao consultar empresas' });
  }
});

// Estoque — dashboard de uma company
apiRouter.get('/api/stock/company/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const [[summary], spots, timeline] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN sc.idUser IS NULL THEN 1 ELSE 0 END) AS disponivel,
          SUM(CASE WHEN sc.idUser IS NOT NULL THEN 1 ELSE 0 END) AS associado,
          SUM(CASE WHEN sc.\`type\` = 'fisico' THEN 1 ELSE 0 END) AS fisico,
          SUM(CASE WHEN sc.\`type\` = 'e-sim' THEN 1 ELSE 0 END) AS esim,
          SUM(CASE WHEN sc.idUser IS NULL AND sc.\`type\` = 'fisico' THEN 1 ELSE 0 END) AS fisicoDisp,
          SUM(CASE WHEN sc.idUser IS NULL AND sc.\`type\` = 'e-sim' THEN 1 ELSE 0 END) AS esimDisp,
          SUM(CASE WHEN sc.idUser IS NOT NULL AND sc.\`type\` = 'fisico' THEN 1 ELSE 0 END) AS fisicoAssoc,
          SUM(CASE WHEN sc.idUser IS NOT NULL AND sc.\`type\` = 'e-sim' THEN 1 ELSE 0 END) AS esimAssoc
        FROM SimCards sc
        WHERE sc.idCompany = ?
      `, [id]),
      pool.query(`
        SELECT
          COALESCE(sc.idSpot, 0) AS idSpot,
          COALESCE(s.name, 'Sem spot') AS spotName,
          ps.name AS parentSpotName,
          COUNT(*) AS total,
          SUM(CASE WHEN sc.idUser IS NULL THEN 1 ELSE 0 END) AS disponivel,
          SUM(CASE WHEN sc.idUser IS NOT NULL THEN 1 ELSE 0 END) AS associado,
          SUM(CASE WHEN sc.\`type\` = 'fisico' THEN 1 ELSE 0 END) AS fisico,
          SUM(CASE WHEN sc.\`type\` = 'e-sim' THEN 1 ELSE 0 END) AS esim,
          SUM(CASE WHEN sc.idUser IS NULL AND sc.\`type\` = 'fisico' THEN 1 ELSE 0 END) AS fisicoDisp,
          SUM(CASE WHEN sc.idUser IS NULL AND sc.\`type\` = 'e-sim' THEN 1 ELSE 0 END) AS esimDisp
        FROM SimCards sc
        LEFT JOIN Spots s ON s.id = sc.idSpot
        LEFT JOIN Spots ps ON ps.id = s.idParent
        WHERE sc.idCompany = ?
        GROUP BY sc.idSpot
        ORDER BY SUM(CASE WHEN sc.idUser IS NULL THEN 1 ELSE 0 END) DESC
      `, [id]),
      pool.query(`
        SELECT
          DATE_FORMAT(DATE_SUB(sc.vdate, INTERVAL 3 HOUR), '%Y-%m-%d') AS dia,
          sc.\`type\` AS tipoChip,
          COUNT(*) AS total
        FROM SimCards sc
        WHERE sc.idCompany = ? AND sc.idUser IS NOT NULL
        GROUP BY dia, sc.\`type\`
        ORDER BY dia ASC
      `, [id]),
    ]);

    res.json({
      summary: summary[0],
      spots: spots[0],
      timeline: timeline[0],
    });
  } catch (err) {
    console.error('Stock company detail error:', err);
    res.status(500).json({ error: 'Erro ao consultar estoque da empresa' });
  }
});

// Pendentes de chip (escolheram physical ou esim mas sem SimCard)
apiRouter.get('/api/meli/pending-chips', async (req, res) => {
  try {
    const chipType = req.query.type || 'physical';
    const [rows] = await pool.query(`
      WITH meli_users AS (
        SELECT DISTINCT mc.idUser
        FROM MgmChain mc
        WHERE mc.mgmInvCode = 'MELI26'
          AND mc.nivel = 1
      )
      SELECT
        u.id AS idUser,
        u.name,
        u.status,
        u.cdate AS dataCadastro,
        CASE WHEN u.idUserParent IS NULL THEN 'Titular' ELSE 'Dependente' END AS tipo,
        um.value AS idMotorista,
        lr.productName,
        lr.amount,
        c.companyName
      FROM meli_users mu
      INNER JOIN Users u ON u.id = mu.idUser
      INNER JOIN UsersMetadata umChip ON umChip.idUser = u.id AND umChip.name = 'getTypeChip' AND umChip.value = ?
      LEFT JOIN UsersMetadata um ON um.idUser = u.id AND um.name = 'identifier'
      LEFT JOIN (
        SELECT *
        FROM (
          SELECT rpc.idUser, p.name AS productName, rpc.amount, rpc.idCompany,
            ROW_NUMBER() OVER (PARTITION BY rpc.idUser ORDER BY rpc.cdate DESC) AS rn
          FROM RecurringPurchasesConfig rpc
          LEFT JOIN Products p ON p.id = rpc.idProduct
          WHERE rpc.idStatus = 1
        ) x WHERE rn = 1
      ) lr ON lr.idUser = u.id
      LEFT JOIN Company c ON c.id = lr.idCompany
      WHERE u.internalUser = 0
        AND NOT EXISTS (SELECT 1 FROM SimCards sc WHERE sc.idUser = u.id)
      ORDER BY u.cdate DESC
    `, [chipType]);
    res.json(rows);
  } catch (err) {
    console.error('Meli pending chips error:', err);
    res.status(500).json({ error: 'Erro ao consultar pendentes de chip' });
  }
});

// Mount API routes at root and under prefix
app.use('/', apiRouter);
app.use(PREFIX, apiRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
