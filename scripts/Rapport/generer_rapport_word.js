/**
 * Générateur de rapport Word GESCARD
 * Usage: node generer_rapport_word.js '<json_data>'
 * Retourne le fichier en base64 sur stdout
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  VerticalAlign,
  PageNumber,
  PageBreak,
  LevelFormat,
} = require('docx');

const ORANGE = 'F77F00';
const BLUE = '0077B6';
const GREEN = '16a34a';
const RED = 'dc2626';
const TEAL = '0d9488';
const GRAY = '6B7280';
const DARK = '1A1A1A';

const fmt = (n) => parseInt(n).toLocaleString('fr-FR');
const tColor = (t) => (t >= 75 ? GREEN : t >= 50 ? ORANGE : RED);
const tLabel = (t) => (t >= 75 ? '🏆 Excellent' : t >= 50 ? '📈 En progression' : '⚠️ À améliorer');
const fmtTaux = (t) => t.toFixed(2).replace('.', ',') + '%';

const border = (color = 'CCCCCC') => ({ style: BorderStyle.SINGLE, size: 1, color });
const borders = (color = 'CCCCCC') => ({
  top: border(color),
  bottom: border(color),
  left: border(color),
  right: border(color),
});
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Page width A4 avec marges 1cm = ~9700 DXA content width
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 720; // 0.5 inch
const CONTENT = PAGE_W - MARGIN * 2; // ~10466

const run = (text, opts = {}) =>
  new TextRun({
    text,
    font: 'Arial',
    size: opts.size || 20,
    bold: opts.bold,
    color: opts.color || DARK,
    ...opts,
  });

const para = (children, opts = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: opts.before || 0, after: opts.after || 160 },
    alignment: opts.align || AlignmentType.LEFT,
    ...opts,
  });

const titre = (text, level = 1) =>
  new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text, font: 'Arial', bold: true, size: level === 1 ? 32 : 26, color: DARK }),
    ],
    spacing: { before: 320, after: 160 },
    border:
      level === 1
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: ORANGE, space: 4 } }
        : undefined,
  });

const saut = () => new Paragraph({ children: [new PageBreak()] });
const spacer = (sz = 120) => para(run('', { size: 1 }), { before: sz, after: 0 });

function headerCell(text, width, bgColor = ORANGE) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: borders(bgColor === ORANGE ? ORANGE : bgColor),
    shading: { fill: bgColor, type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      para([run(text, { bold: true, color: 'FFFFFF', size: 18 })], {
        align: AlignmentType.CENTER,
        before: 0,
        after: 0,
      }),
    ],
  });
}

function dataCell(text, width, opts = {}) {
  const { bg = 'FFFFFF', color = DARK, bold = false, align = AlignmentType.LEFT } = opts;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: borders(),
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      para([run(String(text ?? ''), { color, bold, size: 18 })], { align, before: 0, after: 0 }),
    ],
  });
}

function kpiTable(data) {
  const kpis = [
    { label: 'Total cartes', value: fmt(data.total), color: ORANGE },
    { label: 'Cartes retirées', value: fmt(data.retires), color: GREEN },
    { label: 'Cartes restantes', value: fmt(data.restants), color: BLUE },
    { label: 'Taux de retrait', value: fmtTaux(data.tauxRetrait), color: tColor(data.tauxRetrait) },
  ];
  const col = Math.floor(CONTENT / 4);
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [col, col, col, CONTENT - col * 3],
    rows: [
      new TableRow({
        children: kpis.map(
          (k) =>
            new TableCell({
              width: { size: col, type: WidthType.DXA },
              borders: borders(k.color),
              shading: { fill: 'FAFAFA', type: ShadingType.CLEAR },
              margins: { top: 160, bottom: 160, left: 160, right: 160 },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                para([run(k.value, { bold: true, size: 36, color: k.color })], {
                  align: AlignmentType.CENTER,
                  before: 0,
                  after: 40,
                }),
                para([run(k.label, { size: 16, color: GRAY })], {
                  align: AlignmentType.CENTER,
                  before: 0,
                  after: 0,
                }),
              ],
            })
        ),
      }),
    ],
  });
}

function analyseAuto(sites = []) {
  if (!sites.length) return [];
  const taux_moy = sites.reduce((s, x) => s + x.tauxRetrait, 0) / sites.length;
  const top3 = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, 3);
  const bas3 = [...sites].sort((a, b) => a.tauxRetrait - b.tauxRetrait).slice(0, 3);
  const alertes = sites.filter((s) => s.tauxRetrait < 50);
  const excellents = sites.filter((s) => s.tauxRetrait >= 90);
  const restants = sites.reduce((s, x) => s + x.restants, 0);

  const paras = [];

  paras.push(
    para([
      run(`Taux moyen de retrait : `, { bold: true }),
      run(fmtTaux(taux_moy), { bold: true, color: tColor(taux_moy) }),
      run(`  |  ${sites.length} sites analysés  |  `, {}),
      run(`${fmt(restants)} cartes en attente`, { color: BLUE }),
    ])
  );

  if (excellents.length) {
    paras.push(
      para([
        run('🏆 Sites excellents (≥90%) : ', { bold: true, color: GREEN }),
        run(excellents.map((s) => s.site).join(', '), { color: GREEN }),
      ])
    );
  }

  paras.push(
    para([
      run('✅ Top 3 : ', { bold: true, color: GREEN }),
      run(top3.map((s) => `${s.site} (${fmtTaux(s.tauxRetrait)})`).join(' · ')),
    ])
  );

  if (alertes.length) {
    paras.push(
      para([
        run(`⚠️ ${alertes.length} site(s) en alerte (taux < 50%) : `, { bold: true, color: RED }),
        run(
          alertes
            .slice(0, 5)
            .map((s) => s.site)
            .join(', ') + (alertes.length > 5 ? '...' : ''),
          { color: RED }
        ),
      ])
    );
  }

  paras.push(
    para([
      run('📉 3 sites en retard : ', { bold: true, color: RED }),
      run(bas3.map((s) => `${s.site} (${fmtTaux(s.tauxRetrait)})`).join(' · ')),
    ])
  );

  // Recommandation
  let rec;
  if (taux_moy >= 75)
    rec =
      "Performance excellente. Documenter les bonnes pratiques des sites leaders et les partager à l'ensemble des équipes. Planifier les opérations de clôture.";
  else if (taux_moy >= 50)
    rec = `Performance satisfaisante. Concentrer les efforts sur les ${alertes.length} site(s) en retard. Renforcer les équipes mobiles et intensifier la communication auprès des bénéficiaires.`;
  else
    rec = `Performance insuffisante — action urgente requise. Mobiliser des ressources supplémentaires, lancer une campagne de sensibilisation ciblée et instaurer un suivi quotidien sur les ${alertes.length} site(s) critiques.`;

  paras.push(spacer(80));
  paras.push(para([run('💡 Recommandation : ', { bold: true, color: ORANGE }), run(rec)]));

  return paras;
}

function tableCoordinations(data) {
  const coords = [...(data.coordinations || [])].sort((a, b) => b.tauxRetrait - a.tauxRetrait);
  const cols = [600, 2800, 1600, 1600, 1600, 1200, 2066];
  const headers = ['#', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux', 'Statut'];

  const rows = [
    new TableRow({ children: headers.map((h, i) => headerCell(h, cols[i])) }),
    ...coords.map(
      (c, i) =>
        new TableRow({
          children: [
            dataCell(i + 1, cols[0], {
              align: AlignmentType.CENTER,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
            dataCell(c.coordination, cols[1], { bold: true, bg: i % 2 ? 'F9F9F9' : 'FFFFFF' }),
            dataCell(fmt(c.total), cols[2], {
              align: AlignmentType.RIGHT,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
            dataCell(fmt(c.retires), cols[3], {
              align: AlignmentType.RIGHT,
              color: GREEN,
              bold: true,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
            dataCell(fmt(c.restants), cols[4], {
              align: AlignmentType.RIGHT,
              color: BLUE,
              bold: true,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
            dataCell(fmtTaux(c.tauxRetrait), cols[5], {
              align: AlignmentType.CENTER,
              color: tColor(c.tauxRetrait),
              bold: true,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
            dataCell(tLabel(c.tauxRetrait), cols[6], {
              align: AlignmentType.CENTER,
              bg: i % 2 ? 'F9F9F9' : 'FFFFFF',
            }),
          ],
        })
    ),
  ];

  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

function tableAgences(data) {
  const ags = [...(data.agences || [])].sort((a, b) => b.taux_retrait - a.taux_retrait);
  const cols = [600, 2800, 2200, 800, 800, 1400, 1400, 1066]; // 11066 + 600 ≈ CONTENT
  const sum = cols.reduce((a, b) => a + b, 0);
  const adj = CONTENT - sum;
  cols[cols.length - 1] += adj;
  const headers = ['#', 'Agence', 'Coordination', 'Sites', 'Agents', 'Total', 'Retirées', 'Taux'];

  const rows = [
    new TableRow({ children: headers.map((h, i) => headerCell(h, cols[i], TEAL)) }),
    ...ags.map(
      (a, i) =>
        new TableRow({
          children: [
            dataCell(i + 1, cols[0], { align: AlignmentType.CENTER }),
            dataCell(a.agence_nom, cols[1], { bold: true }),
            dataCell(a.coordination_nom, cols[2]),
            dataCell(a.nombre_sites, cols[3], { align: AlignmentType.CENTER }),
            dataCell(a.nombre_agents, cols[4], { align: AlignmentType.CENTER }),
            dataCell(fmt(a.total_cartes), cols[5], { align: AlignmentType.RIGHT }),
            dataCell(fmt(a.cartes_retirees), cols[6], { align: AlignmentType.RIGHT, color: GREEN }),
            dataCell(fmtTaux(a.taux_retrait), cols[7], {
              align: AlignmentType.CENTER,
              color: tColor(a.taux_retrait),
              bold: true,
            }),
          ],
        })
    ),
  ];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

function tableSites(sites = [], limit = 30) {
  const src = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, limit);
  const cols = [600, 3000, 2200, 1200, 1200, 1200, 900, 1166];
  const sum = cols.reduce((a, b) => a + b, 0);
  cols[cols.length - 1] += CONTENT - sum;
  const headers = ['#', 'Site', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux', 'Statut'];

  const rows = [
    new TableRow({ children: headers.map((h, i) => headerCell(h, cols[i], '7c3aed')) }),
    ...src.map(
      (s, i) =>
        new TableRow({
          children: [
            dataCell(i + 1, cols[0], { align: AlignmentType.CENTER }),
            dataCell(s.site, cols[1], { bold: true }),
            dataCell(s.coordination, cols[2]),
            dataCell(fmt(s.total), cols[3], { align: AlignmentType.RIGHT }),
            dataCell(fmt(s.retires), cols[4], { align: AlignmentType.RIGHT, color: GREEN }),
            dataCell(fmt(s.restants), cols[5], { align: AlignmentType.RIGHT, color: BLUE }),
            dataCell(fmtTaux(s.tauxRetrait), cols[6], {
              align: AlignmentType.CENTER,
              color: tColor(s.tauxRetrait),
              bold: true,
            }),
            dataCell(tLabel(s.tauxRetrait), cols[7]),
          ],
        })
    ),
  ];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

function recommandationsSection(data) {
  const sites = data.sites || [];
  const alertes = sites
    .filter((s) => s.tauxRetrait < 50)
    .sort((a, b) => a.tauxRetrait - b.tauxRetrait);
  const top10 = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, 10);
  const t = data.tauxRetrait;
  const paras = [];

  // Alertes
  paras.push(titre('Sites en Alerte Critique (taux < 50%)', 2));
  if (!alertes.length) {
    paras.push(
      para([
        run('✅ Aucun site en alerte critique. Tous les sites affichent un taux ≥ 50%.', {
          color: GREEN,
        }),
      ])
    );
  } else {
    paras.push(
      para([
        run(`${alertes.length} site(s) nécessitent une intervention prioritaire :`, {
          bold: true,
          color: RED,
        }),
      ])
    );
    paras.push(tableSites(alertes, 20));
  }

  paras.push(spacer(200));

  // Top 10
  paras.push(titre('Top 10 des Meilleurs Performers', 2));
  paras.push(tableSites(top10, 10));

  paras.push(spacer(200));

  // Plan d'action
  paras.push(titre("Plan d'Action Recommandé", 2));

  const actions =
    t >= 75
      ? [
          '1. Documenter les processus des sites leaders et créer un guide de bonnes pratiques.',
          "2. Organiser des visites d'échange entre les meilleurs sites et ceux en retard.",
          "3. Planifier la phase de clôture pour les bénéficiaires n'ayant pas encore retiré leur carte.",
          '4. Préparer le rapport final de distribution pour les autorités compétentes.',
        ]
      : t >= 50
        ? [
            `1. Intervention prioritaire sur les ${alertes.length} site(s) en alerte (taux < 50%) dans les 72 heures.`,
            '2. Déployer des équipes mobiles renforcées dans les zones à faible taux de retrait.',
            '3. Lancer une campagne de communication ciblée (SMS, radio locale, affichage) pour informer les bénéficiaires.',
            '4. Instaurer un reporting hebdomadaire avec indicateurs de suivi par site.',
            '5. Identifier et lever les blocages opérationnels (horaires, accessibilité, documents requis).',
          ]
        : [
            `1. URGENCE : Mobilisation immédiate sur les ${alertes.length} site(s) critiques.`,
            '2. Constituer une cellule de crise dédiée avec réunion quotidienne.',
            "3. Renforcer massivement les équipes sur le terrain et étendre les horaires d'ouverture.",
            '4. Lancer une campagne de sensibilisation multicanal (radio, SMS, chefs de quartier).',
            '5. Déployer des points de distribution mobiles dans les zones géographiquement isolées.',
            "6. Mettre en place un numéro d'assistance pour les bénéficiaires ayant des difficultés.",
          ];

  for (const action of actions) {
    paras.push(para([run(action)], { before: 60, after: 60 }));
  }

  return paras;
}

async function generate(dataStr) {
  const data = JSON.parse(dataStr);
  const now = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 20, color: DARK } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: DARK },
          paragraph: {
            spacing: { before: 400, after: 200 },
            outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ORANGE, space: 4 } },
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial', color: BLUE },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  run("GESCARD — Rapport d'Analyse  ", { size: 16, color: GRAY }),
                  run(`Généré le ${now}`, { size: 16, color: GRAY }),
                ],
                spacing: { before: 0, after: 0 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ORANGE, space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  run('GESCARD v3.2.0  |  Document confidentiel  ', { size: 16, color: GRAY }),
                  run('Page ', { size: 16, color: GRAY }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: 'Arial',
                    size: 16,
                    color: GRAY,
                  }),
                  run(' / ', { size: 16, color: GRAY }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    font: 'Arial',
                    size: 16,
                    color: GRAY,
                  }),
                ],
                spacing: { before: 0, after: 0 },
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: ORANGE, space: 4 } },
              }),
            ],
          }),
        },
        children: [
          // ── PAGE DE TITRE ──────────────────────────────────────
          spacer(800),
          para([run("RAPPORT D'ANALYSE", { bold: true, size: 48, color: ORANGE })], {
            align: AlignmentType.CENTER,
            before: 0,
            after: 120,
          }),
          para([run('GESTION ET DISTRIBUTION DES CARTES', { bold: true, size: 28, color: DARK })], {
            align: AlignmentType.CENTER,
            before: 0,
            after: 80,
          }),
          para([run('GESCARD', { size: 22, color: GRAY })], { align: AlignmentType.CENTER }),
          spacer(240),
          para([run(now, { size: 20, color: GRAY })], { align: AlignmentType.CENTER }),
          spacer(400),

          // Bloc résumé page titre
          new Table({
            width: { size: CONTENT, type: WidthType.DXA },
            columnWidths: [CONTENT],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: CONTENT, type: WidthType.DXA },
                    borders: {
                      top: border(ORANGE),
                      bottom: border(ORANGE),
                      left: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                    },
                    shading: { fill: 'FFF3E0', type: ShadingType.CLEAR },
                    margins: { top: 200, bottom: 200, left: 240, right: 240 },
                    children: [
                      para(
                        [
                          run(`Taux global de retrait : `, { size: 22 }),
                          run(fmtTaux(data.tauxRetrait), {
                            bold: true,
                            size: 28,
                            color: tColor(data.tauxRetrait),
                          }),
                        ],
                        { before: 0, after: 80 }
                      ),
                      para(
                        [
                          run(
                            `${fmt(data.total)} cartes au total  ·  ${fmt(data.retires)} retirées  ·  ${fmt(data.restants)} restantes`,
                            { color: GRAY, size: 18 }
                          ),
                        ],
                        { before: 0, after: 0 }
                      ),
                    ],
                  }),
                ],
              }),
            ],
          }),

          saut(),

          // ── 1. SYNTHÈSE EXÉCUTIVE ──────────────────────────────
          titre('1. Synthèse Exécutive'),
          spacer(80),
          kpiTable(data),
          spacer(200),
          ...analyseAuto(data.sites || []),
          spacer(200),

          saut(),

          // ── 2. ANALYSE PAR COORDINATION ────────────────────────
          titre('2. Analyse par Coordination'),
          spacer(80),
          tableCoordinations(data),
          spacer(240),
          ...analyseAuto(data.sites || []),

          saut(),

          // ── 3. ANALYSE PAR AGENCE ──────────────────────────────
          titre('3. Analyse par Agence'),
          spacer(80),
          ...((data.agences || []).length
            ? [tableAgences(data)]
            : [para([run("Aucune donnée d'agence disponible.", { color: GRAY })])]),
          spacer(200),

          saut(),

          // ── 4. DÉTAIL PAR SITE (TOP 30) ────────────────────────
          titre('4. Détail par Site (Top 30)'),
          para([
            run(
              `${(data.sites || []).length} sites au total. Affichage des 30 premiers par taux de retrait.`,
              { color: GRAY, size: 18 }
            ),
          ]),
          spacer(80),
          tableSites(data.sites || [], 30),
          spacer(200),

          saut(),

          // ── 5. RECOMMANDATIONS ────────────────────────────────
          titre("5. Recommandations et Plan d'Action"),
          spacer(80),
          ...recommandationsSection(data),
          spacer(400),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  process.stdout.write(buf.toString('base64'));
}

generate(process.argv[2]).catch((e) => {
  process.stderr.write(e.message);
  process.exit(1);
});
