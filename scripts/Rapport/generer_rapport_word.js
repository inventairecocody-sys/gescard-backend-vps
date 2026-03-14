/**
 * Générateur de rapport Word GESCARD — Multi-niveaux hiérarchiques
 * Usage: node generer_rapport_word.js '<json_data>'
 * Retourne le fichier en base64 sur stdout
 *
 * Niveaux :
 *   direction    → Administrateur : vue nationale, ton stratégique
 *   coordination → Gestionnaire   : sa coordination, ton managérial
 *   agence       → Chef d'équipe  : son agence, ton opérationnel
 *   site         → Opérateur      : son site, ton direct et actionnable
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
} = require('docx');

// ─── Palette ─────────────────────────────────────────────────────────────────
const ORANGE = 'F77F00';
const BLUE = '0077B6';
const GREEN = '16a34a';
const RED = 'dc2626';
const TEAL = '0d9488';
const PURPLE = '6d28d9';
const GRAY = '6B7280';
const DARK = '1A1A1A';

const NIVEAU_COLOR = { direction: ORANGE, coordination: BLUE, agence: TEAL, site: PURPLE };
const NIVEAU_LABEL = {
  direction: 'DIRECTION CENTRALE — VUE NATIONALE',
  coordination: 'COORDINATION',
  agence: 'AGENCE',
  site: 'SITE',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => parseInt(n).toLocaleString('fr-FR');
const fmtT = (t) => t.toFixed(2).replace('.', ',') + '%';
const tColor = (t) => (t >= 75 ? GREEN : t >= 50 ? ORANGE : RED);
const tLabel = (t) => (t >= 75 ? '🏆 Excellent' : t >= 50 ? '📈 En progression' : '⚠️ À améliorer');

const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 900;
const CONTENT = PAGE_W - MARGIN * 2;

const bdr = (color = 'CCCCCC') => ({ style: BorderStyle.SINGLE, size: 1, color });
const bdrs = (color = 'CCCCCC') => ({
  top: bdr(color),
  bottom: bdr(color),
  left: bdr(color),
  right: bdr(color),
});
const cellM = { top: 80, bottom: 80, left: 120, right: 120 };

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
    spacing: { before: opts.before ?? 0, after: opts.after ?? 160 },
    alignment: opts.align || AlignmentType.LEFT,
    ...(opts.indent ? { indent: opts.indent } : {}),
  });

const spacer = (sz = 160) => para(run('', { size: 2 }), { before: sz, after: 0 });

const saut = () => new Paragraph({ children: [new PageBreak()] });

// Titre de section niveau 1
const h1 = (text, color = DARK, accentColor = ORANGE) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: 'Arial', bold: true, size: 32, color })],
    spacing: { before: 360, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: accentColor, space: 4 } },
  });

// Titre de section niveau 2
const h2 = (text, color = BLUE) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: 'Arial', bold: true, size: 26, color })],
    spacing: { before: 280, after: 160 },
  });

// Cellule d'en-tête de tableau
function hCell(text, width, bg = ORANGE) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: bdrs(bg),
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: cellM,
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

// Cellule de données
function dCell(text, width, opts = {}) {
  const { bg = 'FFFFFF', color = DARK, bold = false, align = AlignmentType.LEFT } = opts;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: bdrs(),
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: cellM,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      para([run(String(text ?? ''), { color, bold, size: 18 })], { align, before: 0, after: 0 }),
    ],
  });
}

// Boîte encadrée colorée (pour les encadrés résumés / alertes)
function encadre(children, borderColor = ORANGE, bg = 'FFF3E0') {
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [CONTENT],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT, type: WidthType.DXA },
            borders: {
              top: bdr(borderColor),
              bottom: bdr(borderColor),
              left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            },
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            children,
          }),
        ],
      }),
    ],
  });
}

// Tableau KPI (4 indicateurs)
function kpiTable(data, accentColor = ORANGE) {
  const kpis = [
    { label: 'Total cartes', value: fmt(data.total), color: ORANGE },
    { label: 'Cartes retirées', value: fmt(data.retires), color: GREEN },
    { label: 'Cartes restantes', value: fmt(data.restants), color: BLUE },
    { label: 'Taux de retrait', value: fmtT(data.tauxRetrait), color: tColor(data.tauxRetrait) },
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
              borders: {
                top: { style: BorderStyle.SINGLE, size: 6, color: accentColor || k.color },
                bottom: bdr(),
                left: bdr(),
                right: bdr(),
              },
              shading: { fill: 'FAFAFA', type: ShadingType.CLEAR },
              margins: { top: 160, bottom: 160, left: 120, right: 120 },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                para([run(k.value, { bold: true, size: 34, color: k.color })], {
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

// ─── Tableaux de données ──────────────────────────────────────────────────────

function tableCoordinations(coords, moy_nat) {
  const sorted = [...coords].sort((a, b) => b.tauxRetrait - a.tauxRetrait);
  const cols = [500, 2600, 1500, 1500, 1500, 1100, 1400, 1866];
  const hdrs = [
    '#',
    'Coordination',
    'Total',
    'Retirées',
    'Restantes',
    'Taux',
    'Écart moy.',
    'Statut',
  ];
  const rows = [
    new TableRow({ children: hdrs.map((h, i) => hCell(h, cols[i], ORANGE)) }),
    ...sorted.map((c, i) => {
      const ecart = c.tauxRetrait - moy_nat;
      const bg = i % 2 ? 'F9F9F9' : 'FFFFFF';
      return new TableRow({
        children: [
          dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
          dCell(c.coordination, cols[1], { bold: true, bg }),
          dCell(fmt(c.total), cols[2], { align: AlignmentType.RIGHT, bg }),
          dCell(fmt(c.retires), cols[3], {
            align: AlignmentType.RIGHT,
            color: GREEN,
            bold: true,
            bg,
          }),
          dCell(fmt(c.restants), cols[4], {
            align: AlignmentType.RIGHT,
            color: BLUE,
            bold: true,
            bg,
          }),
          dCell(fmtT(c.tauxRetrait), cols[5], {
            align: AlignmentType.CENTER,
            color: tColor(c.tauxRetrait),
            bold: true,
            bg,
          }),
          dCell((ecart >= 0 ? '+' : '') + ecart.toFixed(1) + ' pts', cols[6], {
            align: AlignmentType.CENTER,
            color: ecart >= 0 ? GREEN : RED,
            bg,
          }),
          dCell(tLabel(c.tauxRetrait), cols[7], { bg }),
        ],
      });
    }),
  ];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

function tableAgences(agences, niveau) {
  const sorted = [...agences].sort((a, b) => b.taux_retrait - a.taux_retrait);
  const avecCoord = niveau === 'direction';
  const cols = avecCoord
    ? [500, 2400, 1800, 700, 700, 1300, 1300, 1266]
    : [500, 2800, 800, 800, 1400, 1400, 1400, 1366];
  const hdrs = avecCoord
    ? ['#', 'Agence', 'Coordination', 'Sites', 'Agents', 'Total', 'Retirées', 'Taux']
    : ['#', 'Agence', 'Sites', 'Agents', 'Total', 'Retirées', 'Restantes', 'Taux'];
  const bg_h = niveau === 'direction' ? ORANGE : BLUE;
  const rows = [
    new TableRow({ children: hdrs.map((h, i) => hCell(h, cols[i], bg_h)) }),
    ...sorted.map((a, i) => {
      const bg = i % 2 ? 'F9F9F9' : 'FFFFFF';
      const t = a.taux_retrait;
      if (avecCoord) {
        return new TableRow({
          children: [
            dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
            dCell(a.agence_nom, cols[1], { bold: true, bg }),
            dCell(a.coordination_nom, cols[2], { bg }),
            dCell(a.nombre_sites, cols[3], { align: AlignmentType.CENTER, bg }),
            dCell(a.nombre_agents, cols[4], { align: AlignmentType.CENTER, bg }),
            dCell(fmt(a.total_cartes), cols[5], { align: AlignmentType.RIGHT, bg }),
            dCell(fmt(a.cartes_retirees), cols[6], {
              align: AlignmentType.RIGHT,
              color: GREEN,
              bg,
            }),
            dCell(fmtT(t), cols[7], {
              align: AlignmentType.CENTER,
              color: tColor(t),
              bold: true,
              bg,
            }),
          ],
        });
      } else {
        return new TableRow({
          children: [
            dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
            dCell(a.agence_nom, cols[1], { bold: true, bg }),
            dCell(a.nombre_sites, cols[2], { align: AlignmentType.CENTER, bg }),
            dCell(a.nombre_agents, cols[3], { align: AlignmentType.CENTER, bg }),
            dCell(fmt(a.total_cartes), cols[4], { align: AlignmentType.RIGHT, bg }),
            dCell(fmt(a.cartes_retirees), cols[5], {
              align: AlignmentType.RIGHT,
              color: GREEN,
              bg,
            }),
            dCell(fmt(a.cartes_restantes), cols[6], {
              align: AlignmentType.RIGHT,
              color: BLUE,
              bg,
            }),
            dCell(fmtT(t), cols[7], {
              align: AlignmentType.CENTER,
              color: tColor(t),
              bold: true,
              bg,
            }),
          ],
        });
      }
    }),
  ];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

function tableSites(sites, niveau, limit = 30) {
  const sorted = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, limit);
  const avecCoord = niveau === 'direction';
  const avecAgence = niveau === 'coordination';
  const bg_h = niveau === 'direction' ? ORANGE : niveau === 'coordination' ? BLUE : TEAL;

  let cols, hdrs;
  if (avecCoord) {
    cols = [500, 2600, 1800, 1100, 1100, 1100, 900, 1366];
    hdrs = ['#', 'Site', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux', 'Statut'];
  } else if (avecAgence) {
    cols = [500, 2600, 1800, 1100, 1100, 1100, 900, 1366];
    hdrs = ['#', 'Site', 'Agence', 'Total', 'Retirées', 'Restantes', 'Taux', 'Statut'];
  } else {
    cols = [500, 3200, 1400, 1400, 1400, 1000, 1200, 1366];
    hdrs = ['#', 'Site', 'Total', 'Retirées', 'Restantes', 'Taux', 'Statut', 'Priorité'];
  }

  const rows = [
    new TableRow({ children: hdrs.map((h, i) => hCell(h, cols[i], bg_h)) }),
    ...sorted.map((s, i) => {
      const bg = i % 2 ? 'F9F9F9' : 'FFFFFF';
      const t = s.tauxRetrait;
      const prio =
        t < 30 ? '🔴 Urgent' : t < 50 ? '🟠 Prioritaire' : t < 75 ? '🟡 À surveiller' : '🟢 OK';
      if (avecCoord) {
        return new TableRow({
          children: [
            dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
            dCell(s.site, cols[1], { bold: true, bg }),
            dCell(s.coordination || '', cols[2], { color: GRAY, bg }),
            dCell(fmt(s.total), cols[3], { align: AlignmentType.RIGHT, bg }),
            dCell(fmt(s.retires), cols[4], { align: AlignmentType.RIGHT, color: GREEN, bg }),
            dCell(fmt(s.restants), cols[5], { align: AlignmentType.RIGHT, color: BLUE, bg }),
            dCell(fmtT(t), cols[6], {
              align: AlignmentType.CENTER,
              color: tColor(t),
              bold: true,
              bg,
            }),
            dCell(tLabel(t), cols[7], { bg }),
          ],
        });
      } else if (avecAgence) {
        return new TableRow({
          children: [
            dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
            dCell(s.site, cols[1], { bold: true, bg }),
            dCell(s.agence || s.coordination || '', cols[2], { color: GRAY, bg }),
            dCell(fmt(s.total), cols[3], { align: AlignmentType.RIGHT, bg }),
            dCell(fmt(s.retires), cols[4], { align: AlignmentType.RIGHT, color: GREEN, bg }),
            dCell(fmt(s.restants), cols[5], { align: AlignmentType.RIGHT, color: BLUE, bg }),
            dCell(fmtT(t), cols[6], {
              align: AlignmentType.CENTER,
              color: tColor(t),
              bold: true,
              bg,
            }),
            dCell(tLabel(t), cols[7], { bg }),
          ],
        });
      } else {
        return new TableRow({
          children: [
            dCell(i + 1, cols[0], { align: AlignmentType.CENTER, bg }),
            dCell(s.site, cols[1], { bold: true, bg }),
            dCell(fmt(s.total), cols[2], { align: AlignmentType.RIGHT, bg }),
            dCell(fmt(s.retires), cols[3], { align: AlignmentType.RIGHT, color: GREEN, bg }),
            dCell(fmt(s.restants), cols[4], { align: AlignmentType.RIGHT, color: BLUE, bg }),
            dCell(fmtT(t), cols[5], {
              align: AlignmentType.CENTER,
              color: tColor(t),
              bold: true,
              bg,
            }),
            dCell(tLabel(t), cols[6], { bg }),
            dCell(prio, cols[7], { align: AlignmentType.CENTER, bg }),
          ],
        });
      }
    }),
  ];
  return new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows });
}

// ─── Analyses et recommandations par niveau ──────────────────────────────────

function analyseParagraphes(data, ctx, niveau) {
  const sites = data.sites || [];
  const coords = data.coordinations || [];
  const agences = data.agences || [];
  const t = data.tauxRetrait || 0;
  const restants = data.restants || 0;
  const paras = [];

  if (niveau === 'direction') {
    const moy_nat = coords.length
      ? coords.reduce((s, c) => s + c.tauxRetrait, 0) / coords.length
      : 0;
    const alertes = coords.filter((c) => c.tauxRetrait < 60);
    const top3 = [...coords].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, 3);
    const bas3 = [...coords].sort((a, b) => a.tauxRetrait - b.tauxRetrait).slice(0, 3);

    paras.push(
      para([
        run('Taux moyen national : ', { bold: true }),
        run(fmtT(moy_nat), { bold: true, color: tColor(moy_nat) }),
        run(`  |  ${coords.length} coordinations analysées  |  `),
        run(`${fmt(restants)} cartes en attente de retrait par les requérants`, { color: BLUE }),
      ])
    );
    if (top3.length)
      paras.push(
        para([
          run('🏆 Coordinations leaders : ', { bold: true, color: GREEN }),
          run(top3.map((c) => `${c.coordination} (${fmtT(c.tauxRetrait)})`).join('  ·  ')),
        ])
      );
    if (alertes.length)
      paras.push(
        para([
          run(`⚠️ ${alertes.length} coordination(s) sous le seuil de 60% : `, {
            bold: true,
            color: RED,
          }),
          run(alertes.map((c) => c.coordination).join(', '), { color: RED }),
        ])
      );
    paras.push(
      para([
        run('📉 Coordinations les plus en retard : ', { bold: true, color: RED }),
        run(
          bas3
            .map((c) => {
              const ecart = moy_nat - c.tauxRetrait;
              return `${c.coordination} (${fmtT(c.tauxRetrait)} — ${ecart.toFixed(1)} pts sous la moyenne)`;
            })
            .join('  ·  ')
        ),
      ])
    );
  } else if (niveau === 'coordination') {
    const coord_nom = ctx.coordination || 'votre coordination';
    const moy_nat = coords.length
      ? coords.reduce((s, c) => s + c.tauxRetrait, 0) / coords.length
      : 0;
    const ecart = t - moy_nat;
    const signe = ecart >= 0 ? `+${ecart.toFixed(1)}` : ecart.toFixed(1);
    const alertes = agences.filter((a) => a.taux_retrait < 55);
    const ag_crit = agences.length
      ? agences.reduce((m, a) => (a.cartes_restantes > m.cartes_restantes ? a : m))
      : null;

    paras.push(
      para([
        run(`Taux de la coordination ${coord_nom} : `, { bold: true }),
        run(fmtT(t), { bold: true, color: tColor(t) }),
        run(`  |  Moyenne nationale : ${fmtT(moy_nat)}  |  Écart : `),
        run(`${signe} pts`, { bold: true, color: ecart >= 0 ? GREEN : RED }),
      ])
    );
    paras.push(
      para([
        run(
          `${fmt(restants)} requérant(s) n'ont pas encore retiré leur carte dans cette coordination.`,
          { color: BLUE }
        ),
      ])
    );
    if (ag_crit) {
      const pct = restants > 0 ? ((ag_crit.cartes_restantes / restants) * 100).toFixed(0) : 0;
      paras.push(
        para([
          run(`⚠️ Agence concentrant le plus de retard : `, { bold: true, color: RED }),
          run(
            `${ag_crit.agence_nom} — ${fmt(ag_crit.cartes_restantes)} cartes (${pct}% du retard de la coordination).`,
            { color: RED }
          ),
        ])
      );
    }
    if (alertes.length)
      paras.push(
        para([
          run(`⚠️ Agences sous 55% : `, { bold: true, color: RED }),
          run(alertes.map((a) => a.agence_nom).join(', '), { color: RED }),
        ])
      );
  } else if (niveau === 'agence') {
    const agence_nom = ctx.agence || 'votre agence';
    const ags_sorted = [...agences].sort((a, b) => b.taux_retrait - a.taux_retrait);
    const rang = ags_sorted.findIndex((a) => a.agence_nom === agence_nom) + 1 || null;
    const rang_str = rang ? `${rang}e sur ${agences.length} agences dans la coordination` : '';
    const alertes = sites.filter((s) => s.tauxRetrait < 50);
    const top_s = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, 2);

    paras.push(
      para([
        run(`Taux de l'agence : `, { bold: true }),
        run(fmtT(t), { bold: true, color: tColor(t) }),
        run(
          rang_str
            ? `  |  ${rang_str}  |  ${sites.length} site(s) gérés`
            : `  |  ${sites.length} site(s) gérés`
        ),
      ])
    );
    paras.push(
      para([
        run(`${fmt(restants)} requérant(s) n'ont pas encore retiré leur carte dans cette agence.`, {
          color: BLUE,
        }),
      ])
    );
    if (top_s.length)
      paras.push(
        para([
          run('🏆 Sites les plus performants : ', { bold: true, color: GREEN }),
          run(top_s.map((s) => `${s.site} (${fmtT(s.tauxRetrait)})`).join('  ·  '), {
            color: GREEN,
          }),
        ])
      );
    if (alertes.length)
      paras.push(
        para([
          run(`⚠️ ${alertes.length} site(s) sous 50% : `, { bold: true, color: RED }),
          run(
            alertes
              .slice(0, 4)
              .map(
                (s) => `${s.site} (${fmtT(s.tauxRetrait)} — ${fmt(s.restants)} cartes en attente)`
              )
              .join(', '),
            { color: RED }
          ),
        ])
      );
  } else if (niveau === 'site') {
    const site_nom = ctx.site || 'votre site';
    const s_sorted = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait);
    const rang = s_sorted.findIndex((s) => s.site === site_nom) + 1 || null;
    const rang_str = rang ? `classé ${rang}e sur ${sites.length} sites de l'agence` : '';
    const retires_n = data.retires || 0;
    let rythme = '';
    if (retires_n > 0 && restants > 0) {
      const j = Math.max(1, Math.round(restants / Math.max(retires_n / 30, 1)));
      rythme = `Au rythme actuel, environ ${j} jour(s) supplémentaire(s) pour traiter les cartes restantes.`;
    }

    paras.push(
      para([
        run('Taux de retrait du site : ', { bold: true }),
        run(fmtT(t), { bold: true, size: 26, color: tColor(t) }),
        run(rang_str ? `  —  ${rang_str}` : ''),
      ])
    );
    paras.push(
      para([
        run(`${fmt(restants)} requérant(s) n'ont pas encore retiré leur carte sur ce site.`, {
          color: BLUE,
        }),
      ])
    );
    if (rythme) paras.push(para([run(rythme, { color: GRAY })]));
  }

  return paras;
}

function recommandationsParagraphes(data, ctx, niveau) {
  const sites = data.sites || [];
  const t = data.tauxRetrait || 0;
  const seuil = { direction: 60, coordination: 55, agence: 50, site: 50 }[niveau];
  const alertes = sites
    .filter((s) => s.tauxRetrait < seuil)
    .sort((a, b) => a.tauxRetrait - b.tauxRetrait);
  const paras = [];

  const actions = {
    direction: {
      75: [
        'Performance nationale excellente. Le système de distribution fonctionne efficacement.',
        '→ Documenter les processus des coordinations leaders et déployer un guide de bonnes pratiques national.',
        '→ Organiser des échanges entre les coordinations les plus performantes et celles en retard.',
        "→ Engager la phase de clôture pour les requérants n'ayant pas encore retiré leur carte.",
        '→ Préparer le rapport final de distribution pour les autorités compétentes.',
      ],
      50: [
        'Performance nationale satisfaisante mais hétérogène — des coordinations accusent un retard significatif.',
        `→ Déclencher un audit opérationnel sur les ${alertes.length} coordination(s) dont le taux est inférieur au seuil de 60%.`,
        '→ Réallouer des ressources humaines des zones performantes vers les zones critiques.',
        '→ Instaurer un reporting hebdomadaire national avec indicateurs de suivi par coordination.',
        '→ Identifier et lever les blocages opérationnels empêchant les requérants de retirer leur carte.',
      ],
      0: [
        'Situation critique — mobilisation nationale immédiate requise.',
        '→ Constituer une cellule de crise nationale avec réunion quotidienne de suivi.',
        '→ Déployer des équipes renforcées dans toutes les coordinations sous 50%.',
        '→ Lancer une campagne de sensibilisation multicanal pour les requérants non venus (radio, SMS, affichage).',
        '→ Fixer des objectifs hebdomadaires contraignants par coordination avec reporting quotidien.',
        '→ Envisager des points de distribution mobiles dans les zones géographiquement isolées.',
      ],
    },
    coordination: {
      75: [
        'Votre coordination affiche une performance excellente.',
        '→ Partager les bonnes pratiques des agences les plus performantes avec les agences en retard.',
        '→ Finaliser les relances auprès des requérants restants via les responsables de site.',
        "→ Maintenir le suivi hebdomadaire des sites jusqu'à clôture.",
      ],
      50: [
        'Performance satisfaisante dans votre coordination — des efforts ciblés restent nécessaires.',
        `→ Demander un rapport hebdomadaire aux chefs d'équipe des ${alertes.length > 0 ? alertes.length : ''} agences en retard.`,
        '→ Fixer un objectif de taux cible par agence pour la prochaine période de suivi.',
        '→ Vérifier que les requérants des sites critiques ont bien reçu une notification de retrait.',
        '→ Envisager des permanences supplémentaires sur les sites à fort volume de cartes restantes.',
      ],
      0: [
        'Performance insuffisante dans votre coordination — action urgente requise.',
        `→ Mobilisation immédiate sur les ${alertes.length} site(s) en alerte.`,
        "→ Renforcer les équipes terrain et étendre les horaires d'ouverture des sites.",
        '→ Lancer une campagne de relance ciblée auprès des requérants non venus.',
        '→ Instaurer un suivi quotidien avec un point de situation chaque matin.',
      ],
    },
    agence: {
      75: [
        'Votre agence est en bonne performance.',
        '→ Accompagner les sites encore en dessous de 75% pour les aider à progresser.',
        '→ Signaler à la coordination les requérants injoignables ou présentant des problèmes de documents.',
      ],
      50: [
        'Performance correcte — concentration des efforts sur les sites en retard.',
        `→ Intervention prioritaire sur les ${alertes.length} site(s) dont le taux est inférieur à 50% cette semaine.`,
        '→ Vérifier que tous les requérants des sites critiques ont été contactés.',
        '→ Envisager une permanence supplémentaire ou un renfort mobile sur les sites à fort volume restant.',
        '→ Remonter les blocages identifiés (requérants injoignables, problèmes de documents) à la coordination.',
      ],
      0: [
        'Performance insuffisante dans votre agence — action immédiate requise.',
        `→ ${alertes.length} site(s) en alerte critique nécessitent une intervention sous 48 heures.`,
        '→ Déployer un agent mobile sur les sites les plus en retard.',
        "→ Contacter personnellement les responsables des sites en alerte pour établir un plan d'action.",
        '→ Signaler la situation à la coordination et demander des renforts si nécessaire.',
        "→ Mettre en place un point quotidien avec les responsables de sites jusqu'au redressement.",
      ],
    },
    site: {
      75: [
        'Votre site affiche une performance excellente.',
        '→ Maintenir le rythme actuel de distribution.',
        "→ Signaler à votre chef d'équipe les requérants injoignables.",
        '→ Vérifier que les requérants restants ont bien reçu une notification de retrait.',
      ],
      50: [
        "Des requérants de votre site n'ont pas encore retiré leur carte.",
        "→ Établir la liste des requérants n'ayant pas retiré leur carte et tenter un contact téléphonique.",
        "→ Signaler à votre chef d'équipe les cas de requérants injoignables.",
        "→ Vérifier que les horaires d'ouverture sont bien affichés et communiqués.",
        '→ Orienter les requérants ayant des problèmes de documents vers le bon interlocuteur.',
      ],
      0: [
        'Taux critique — intervention requise immédiatement.',
        "→ Établir la liste complète des requérants n'ayant pas retiré leur carte.",
        '→ Lancer les relances téléphoniques ou par affichage local.',
        "→ Informer votre chef d'équipe et demander un renfort ou une permanence supplémentaire.",
        '→ Identifier les requérants avec problèmes de documents et les orienter.',
        "→ Tenir un registre quotidien des retraits jusqu'à atteindre l'objectif.",
      ],
    },
  };

  const seuil_p = t >= 75 ? 75 : t >= 50 ? 50 : 0;
  const liste = actions[niveau][seuil_p];

  for (const action of liste) {
    const isTitle = !action.startsWith('→');
    paras.push(
      para(
        [
          run(action, {
            bold: isTitle,
            color: isTitle ? (t >= 75 ? GREEN : t >= 50 ? ORANGE : RED) : DARK,
            size: isTitle ? 20 : 18,
          }),
        ],
        {
          before: isTitle ? 80 : 40,
          after: isTitle ? 80 : 40,
          indent: action.startsWith('→') ? { left: 360 } : undefined,
        }
      )
    );
  }

  // Table des alertes (si applicable)
  if (alertes.length > 0) {
    paras.push(spacer(120));
    paras.push(
      para([
        run(`Sites nécessitant une intervention prioritaire (taux < ${seuil}%) :`, {
          bold: true,
          color: RED,
        }),
      ])
    );
    paras.push(spacer(80));
    paras.push(tableSites(alertes, niveau, 20));
  }

  return paras;
}

// ─── Constructeur de document par niveau ─────────────────────────────────────

async function generate(dataStr) {
  const data = JSON.parse(dataStr);
  const ctx = data._contexte || {};
  const niveau = ctx.niveau || 'direction';
  const sites = data.sites || [];
  const coords = data.coordinations || [];
  const t = data.tauxRetrait || 0;
  const color = NIVEAU_COLOR[niveau];

  const now = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Nom de l'entité selon le niveau
  const nomEntite = ctx.coordination || ctx.agence || ctx.site || '';
  const titrePrincipal = `RAPPORT D'ANALYSE — ${NIVEAU_LABEL[niveau]}${nomEntite ? ' : ' + nomEntite.toUpperCase() : ''}`;

  // Sous-titres de sections selon le niveau
  const sections = {
    direction: [
      '1. Synthèse Nationale',
      '2. Performance par Coordination',
      '3. Analyse par Agence',
      '4. Détail par Site (Top 30)',
      '5. Recommandations Stratégiques',
    ],
    coordination: [
      '1. Synthèse de la Coordination',
      '2. Performance des Agences',
      '3. Détail des Sites',
      "4. Plan d'Action",
    ],
    agence: [
      "1. Synthèse de l'Agence",
      '2. Performance des Sites',
      '3. Sites Prioritaires',
      '4. Actions de la Semaine',
    ],
    site: ['1. État Actuel du Site', "2. Position dans l'Agence", '3. Actions Immédiates'],
  }[niveau];

  // Moy nationale pour coordinations
  const moy_nat = coords.length ? coords.reduce((s, c) => s + c.tauxRetrait, 0) / coords.length : 0;

  // ── Contenu du document ───────────────────────────────────────────────────
  const children = [];

  // PAGE DE TITRE
  children.push(spacer(600));
  children.push(
    para([run(titrePrincipal, { bold: true, size: 44, color })], {
      align: AlignmentType.CENTER,
      before: 0,
      after: 120,
    })
  );
  children.push(
    para([run('GESTION ET DISTRIBUTION DES CARTES', { bold: true, size: 26, color: DARK })], {
      align: AlignmentType.CENTER,
      before: 0,
      after: 80,
    })
  );
  children.push(para([run('GESCARD', { size: 20, color: GRAY })], { align: AlignmentType.CENTER }));
  children.push(spacer(160));
  children.push(para([run(now, { size: 20, color: GRAY })], { align: AlignmentType.CENTER }));
  if (ctx.nomUtilisateur) {
    children.push(
      para([run(`Établi pour : ${ctx.nomUtilisateur}`, { size: 18, color: GRAY })], {
        align: AlignmentType.CENTER,
      })
    );
  }
  children.push(spacer(300));

  // Encadré résumé page titre
  const resumeContent = [
    para(
      [
        run('Taux de retrait : ', { size: 22 }),
        run(fmtT(t), { bold: true, size: 30, color: tColor(t) }),
      ],
      { before: 0, after: 80 }
    ),
    para(
      [
        run(
          `${fmt(data.total)} cartes au total  ·  ${fmt(data.retires)} retirées  ·  ${fmt(data.restants)} en attente de retrait par les requérants`,
          { color: GRAY, size: 18 }
        ),
      ],
      { before: 0, after: 0 }
    ),
  ];
  if (niveau === 'coordination') {
    resumeContent.push(
      para(
        [
          run(`Moyenne nationale : ${fmtT(moy_nat)}  |  Écart : `, { size: 18, color: GRAY }),
          run((t - moy_nat >= 0 ? '+' : '') + (t - moy_nat).toFixed(1) + ' pts', {
            bold: true,
            size: 18,
            color: t - moy_nat >= 0 ? GREEN : RED,
          }),
        ],
        { before: 60, after: 0 }
      )
    );
  }
  if (niveau === 'agence') {
    const ags_sorted = [...(data.agences || [])].sort((a, b) => b.taux_retrait - a.taux_retrait);
    const rang = ags_sorted.findIndex((a) => a.agence_nom === ctx.agence) + 1;
    if (rang > 0) {
      resumeContent.push(
        para(
          [
            run(
              `Position dans la coordination : ${rang}e agence sur ${(data.agences || []).length}`,
              { size: 18, color: GRAY }
            ),
          ],
          { before: 60, after: 0 }
        )
      );
    }
  }
  if (niveau === 'site') {
    const s_sorted = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait);
    const rang = s_sorted.findIndex((s) => s.site === ctx.site) + 1;
    if (rang > 0) {
      resumeContent.push(
        para(
          [
            run(`Position dans l'agence : ${rang}e site sur ${sites.length}`, {
              size: 18,
              color: GRAY,
            }),
          ],
          { before: 60, after: 0 }
        )
      );
    }
  }

  children.push(encadre(resumeContent, color, 'F9F9F9'));
  children.push(saut());

  // ── SECTION 1 — Synthèse ─────────────────────────────────────────────────
  children.push(h1(sections[0], DARK, color));
  children.push(spacer(80));
  children.push(kpiTable(data, color));
  children.push(spacer(200));
  children.push(...analyseParagraphes(data, ctx, niveau));
  children.push(spacer(200));
  children.push(saut());

  // ── SECTION 2 — Coordination / Agences / Sites / Position ────────────────
  children.push(h1(sections[1], DARK, color));
  children.push(spacer(80));

  if (niveau === 'direction') {
    // Table coordinations
    if (coords.length) {
      children.push(tableCoordinations(coords, moy_nat));
    } else {
      children.push(para([run('Aucune donnée de coordination disponible.', { color: GRAY })]));
    }
  } else if (niveau === 'coordination') {
    // Table agences de la coordination
    children.push(
      para(
        [run(`Agences de la coordination ${ctx.coordination || ''} :`, { bold: true, size: 20 })],
        { after: 120 }
      )
    );
    if ((data.agences || []).length) {
      children.push(tableAgences(data.agences || [], niveau));
    } else {
      children.push(para([run("Aucune donnée d'agence disponible.", { color: GRAY })]));
    }
  } else if (niveau === 'agence') {
    // Table sites de l'agence
    children.push(
      para([run(`Sites de l'agence ${ctx.agence || ''} :`, { bold: true, size: 20 })], {
        after: 120,
      })
    );
    if (sites.length) {
      children.push(tableSites(sites, niveau, 50));
    } else {
      children.push(para([run('Aucune donnée de site disponible.', { color: GRAY })]));
    }
  } else if (niveau === 'site') {
    // Tableau simple état du site
    const siteT = data.tauxRetrait || 0;
    const infoRows = [
      [
        'Total cartes affectées',
        fmt(data.total || 0),
        'Nombre total de cartes à distribuer sur ce site',
      ],
      ['Cartes retirées', fmt(data.retires || 0), 'Requérants ayant retiré leur carte'],
      ['Cartes restantes', fmt(data.restants || 0), "Requérants n'ayant pas encore retiré"],
      ['Taux de retrait', fmtT(siteT), tLabel(siteT)],
    ];
    const cols = [2400, 1400, CONTENT - 3800];
    const rows = [
      new TableRow({
        children: [
          hCell('Indicateur', cols[0], color),
          hCell('Valeur', cols[1], color),
          hCell('Détail', cols[2], color),
        ],
      }),
      ...infoRows.map((row, i) => {
        const bg = i % 2 ? 'F9F9F9' : 'FFFFFF';
        return new TableRow({
          children: [
            dCell(row[0], cols[0], { bold: true, bg }),
            dCell(row[1], cols[1], {
              align: AlignmentType.CENTER,
              bold: true,
              color: row[0].includes('Taux') ? tColor(siteT) : DARK,
              bg,
            }),
            dCell(row[2], cols[2], { color: GRAY, bg }),
          ],
        });
      }),
    ];
    children.push(
      new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cols, rows })
    );
    children.push(spacer(200));

    // Position dans l'agence
    const s_sorted = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait);
    const rang = s_sorted.findIndex((s) => s.site === ctx.site) + 1;
    if (rang > 0 && sites.length > 1) {
      children.push(
        para([
          run(`Votre site est classé `, {}),
          run(`${rang}e`, { bold: true, color }),
          run(` sur ${sites.length} sites de l'agence ${ctx.agence || ''}.`),
        ])
      );
      children.push(spacer(120));
      children.push(tableSites(sites, niveau, sites.length));
    }
    children.push(spacer(200));
    children.push(saut());

    // ── SECTION 3 SITE — Actions immédiates ──────────────────────────────
    children.push(h1(sections[2], DARK, color));
    children.push(spacer(80));
    children.push(...recommandationsParagraphes(data, ctx, niveau));
    children.push(spacer(400));
  }

  if (niveau !== 'site') {
    children.push(spacer(200));
    children.push(saut());

    // ── SECTION 3 — Agences critiques / Sites / Sites prioritaires ────────
    children.push(h1(sections[2], DARK, color));
    children.push(spacer(80));

    if (niveau === 'direction') {
      // Table agences (tous niveaux)
      children.push(
        para([run('Classement des agences par taux de retrait :', { bold: true })], { after: 120 })
      );
      if ((data.agences || []).length) {
        children.push(tableAgences(data.agences || [], niveau));
      }
    } else if (niveau === 'coordination') {
      // Sites de la coordination
      children.push(
        para([run(`Sites de la coordination ${ctx.coordination || ''} :`, { bold: true })], {
          after: 120,
        })
      );
      if (sites.length) {
        children.push(tableSites(sites, niveau, 30));
      }
    } else if (niveau === 'agence') {
      // Sites prioritaires (en alerte)
      const alertes = sites
        .filter((s) => s.tauxRetrait < 50)
        .sort((a, b) => a.tauxRetrait - b.tauxRetrait);
      if (alertes.length) {
        children.push(
          para(
            [
              run(
                `${alertes.length} site(s) nécessitent une attention prioritaire (taux < 50%) :`,
                { bold: true, color: RED }
              ),
            ],
            { after: 120 }
          )
        );
        children.push(tableSites(alertes, niveau, alertes.length));
        children.push(spacer(160));
      } else {
        children.push(
          para([
            run('✅ Tous les sites de votre agence affichent un taux ≥ 50%.', { color: GREEN }),
          ])
        );
      }
      // Top performers
      const top5 = [...sites].sort((a, b) => b.tauxRetrait - a.tauxRetrait).slice(0, 5);
      children.push(spacer(120));
      children.push(h2('Top 5 des meilleurs sites', GREEN));
      children.push(tableSites(top5, niveau, 5));
    }

    children.push(spacer(200));
    children.push(saut());

    // ── SECTION 4 — Sites / Recommandations ──────────────────────────────
    children.push(h1(sections[3], DARK, color));
    children.push(spacer(80));

    if (niveau === 'direction') {
      // Top 30 sites
      children.push(
        para([
          run(`${sites.length} sites au total. Affichage des 30 premiers par taux de retrait.`, {
            color: GRAY,
            size: 18,
          }),
        ])
      );
      children.push(spacer(80));
      children.push(tableSites(sites, niveau, 30));
      children.push(spacer(200));
      children.push(saut());

      // ── SECTION 5 DIRECTION — Recommandations ────────────────────────
      children.push(h1(sections[4], DARK, color));
      children.push(spacer(80));
      children.push(...recommandationsParagraphes(data, ctx, niveau));
    } else if (niveau === 'coordination') {
      children.push(...recommandationsParagraphes(data, ctx, niveau));
    } else if (niveau === 'agence') {
      children.push(...recommandationsParagraphes(data, ctx, niveau));
    }

    children.push(spacer(400));
  }

  // ── Construction du document ──────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20, color: DARK } } },
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
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color, space: 4 } },
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial', color },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
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
                  run(`GESCARD — ${NIVEAU_LABEL[niveau]}${nomEntite ? ' : ' + nomEntite : ''}  `, {
                    size: 16,
                    color: GRAY,
                  }),
                  run(`Généré le ${now}`, { size: 16, color: GRAY }),
                ],
                spacing: { before: 0, after: 0 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  run('GESCARD  |  Document confidentiel  ', { size: 16, color: GRAY }),
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
                border: { top: { style: BorderStyle.SINGLE, size: 4, color, space: 4 } },
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  process.stdout.write(buf.toString('base64'));
}

generate(process.argv[2]).catch((e) => {
  process.stderr.write(e.message + '\n' + e.stack);
  process.exit(1);
});
