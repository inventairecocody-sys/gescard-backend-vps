"""
Générateur de rapport Excel GESCARD
Usage: python generer_rapport_excel.py '<json_data>'
Retourne le fichier en base64 sur stdout
"""
import sys, json, base64, io, datetime
from openpyxl import Workbook
from openpyxl.styles import (Font, PatternFill, Alignment, Border, Side,
                              GradientFill)
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.chart.series import DataPoint

def cell_border():
    s = Side(style='thin', color='CCCCCC')
    return Border(left=s, right=s, top=s, bottom=s)

def taux_color(taux):
    if taux >= 75: return '16a34a'
    if taux >= 50: return 'f59e0b'
    return 'dc2626'

def header_fill():  return PatternFill('solid', start_color='F77F00', end_color='F77F00')
def sub_fill():     return PatternFill('solid', start_color='FFF3E0', end_color='FFF3E0')
def alt_fill():     return PatternFill('solid', start_color='F9F9F9', end_color='F9F9F9')
def white_fill():   return PatternFill('solid', start_color='FFFFFF', end_color='FFFFFF')

def header_font():  return Font(name='Arial', bold=True, color='FFFFFF', size=11)
def title_font(sz=14): return Font(name='Arial', bold=True, color='1A1A1A', size=sz)
def bold_font():    return Font(name='Arial', bold=True, color='1A1A1A', size=10)
def normal_font():  return Font(name='Arial', color='1A1A1A', size=10)
def small_font(c='6B7280'): return Font(name='Arial', color=c, size=9)

def set_col_width(ws, col, w): ws.column_dimensions[get_column_letter(col)].width = w
def center(ws, row, col): ws.cell(row, col).alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
def bold_center(ws, row, col): ws.cell(row, col).alignment = Alignment(horizontal='center', vertical='center')

def write_header_row(ws, row, headers, widths=None):
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=row, column=c, value=h)
        cell.font = header_font()
        cell.fill = header_fill()
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = cell_border()
    if widths:
        for c, w in enumerate(widths, 1):
            set_col_width(ws, c, w)

def write_data_row(ws, row, values, is_alt=False):
    fill = alt_fill() if is_alt else white_fill()
    for c, v in enumerate(values, 1):
        cell = ws.cell(row=row, column=c, value=v)
        cell.font = normal_font()
        cell.fill = fill
        cell.border = cell_border()
        cell.alignment = Alignment(horizontal='center' if isinstance(v, (int, float)) else 'left', vertical='center')

def fmt(n): return f"{int(n):,}".replace(',', ' ')
def fmt_taux(t): return f"{t:.2f}".replace('.', ',') + '%'

def analyse_auto(sites, label=''):
    """Génère commentaires automatiques d'analyse"""
    if not sites: return []
    taux_list = [s['tauxRetrait'] for s in sites]
    taux_moy  = sum(taux_list) / len(taux_list) if taux_list else 0
    top3      = sorted(sites, key=lambda s: s['tauxRetrait'], reverse=True)[:3]
    bas3      = sorted(sites, key=lambda s: s['tauxRetrait'])[:3]
    alertes   = [s for s in sites if s['tauxRetrait'] < 50]
    excellents= [s for s in sites if s['tauxRetrait'] >= 90]
    restants  = sum(s['restants'] for s in sites)

    lignes = []
    lignes.append(f"📊 SYNTHÈSE AUTOMATIQUE — {label}")
    lignes.append(f"Taux moyen de retrait : {fmt_taux(taux_moy)}  |  {len(sites)} sites analysés  |  {fmt(restants)} cartes encore en attente")
    lignes.append("")
    if excellents:
        lignes.append(f"🏆 PERFORMANCE EXCELLENTE (≥90%) : {', '.join(s['site'] for s in excellents)}")
    lignes.append(f"✅ TOP 3 des meilleurs sites : " + " · ".join(f"{s['site']} ({fmt_taux(s['tauxRetrait'])})" for s in top3))
    lignes.append(f"⚠️  Sites nécessitant attention (<50%) : {len(alertes)} site(s)")
    if alertes:
        lignes.append(f"   → {', '.join(s['site'] for s in alertes[:5])}" + ("..." if len(alertes) > 5 else ""))
    lignes.append(f"📉 3 sites les plus en retard : " + " · ".join(f"{s['site']} ({fmt_taux(s['tauxRetrait'])})" for s in bas3))
    lignes.append("")
    if taux_moy >= 75:
        lignes.append("💡 RECOMMANDATION : Niveau de performance excellent. Maintenir la cadence et partager les bonnes pratiques des sites leaders.")
    elif taux_moy >= 50:
        lignes.append("💡 RECOMMANDATION : Performance satisfaisante. Concentrer les efforts sur les sites en retard et renforcer les opérations à mi-parcours.")
    else:
        lignes.append("💡 RECOMMANDATION : Performance insuffisante. Action urgente requise — mobilisation des équipes sur le terrain, renforcement logistique et suivi hebdomadaire.")
    return lignes

def create_resume_sheet(wb, data):
    ws = wb.active
    ws.title = "📊 Résumé Exécutif"
    ws.sheet_view.showGridLines = False

    # Titre
    ws.merge_cells('A1:H1')
    ws['A1'] = "RAPPORT D'ANALYSE — GESCARD"
    ws['A1'].font = Font(name='Arial', bold=True, size=18, color='FFFFFF')
    ws['A1'].fill = PatternFill('solid', start_color='F77F00', end_color='FF9E40')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 45

    ws.merge_cells('A2:H2')
    ws['A2'] = f"Généré le {datetime.datetime.now().strftime('%d/%m/%Y à %H:%M')}  |  {data.get('metadata', {}).get('nb_coordinations', '')} coordinations"
    ws['A2'].font = small_font('FFFFFF')
    ws['A2'].fill = PatternFill('solid', start_color='CC6600', end_color='CC6600')
    ws['A2'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[2].height = 22

    # KPIs
    row = 4
    ws.merge_cells(f'A{row}:H{row}')
    ws.cell(row, 1, "INDICATEURS CLÉS DE PERFORMANCE").font = title_font(12)
    ws.cell(row, 1).alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[row].height = 28

    row = 5
    kpis = [
        ("Total cartes", fmt(data['total']),       'F77F00'),
        ("Cartes retirées", fmt(data['retires']),   '16a34a'),
        ("Cartes restantes", fmt(data['restants']), '0077B6'),
        ("Taux de retrait", fmt_taux(data['tauxRetrait']), taux_color(data['tauxRetrait'])),
    ]
    for i, (label, value, color) in enumerate(kpis):
        col = i * 2 + 1
        # Valeur
        ws.merge_cells(start_row=row, start_column=col, end_row=row, end_column=col+1)
        c = ws.cell(row, col, value)
        c.font = Font(name='Arial', bold=True, size=22, color=color)
        c.alignment = Alignment(horizontal='center', vertical='center')
        c.fill = PatternFill('solid', start_color='F9F9F9', end_color='F9F9F9')
        c.border = Border(
            top=Side(style='thick', color=color),
            bottom=Side(style='thin', color='EEEEEE'),
            left=Side(style='thin', color='EEEEEE'),
            right=Side(style='thin', color='EEEEEE'),
        )
        ws.row_dimensions[row].height = 42
        # Label
        ws.merge_cells(start_row=row+1, start_column=col, end_row=row+1, end_column=col+1)
        c2 = ws.cell(row+1, col, label)
        c2.font = small_font('555555')
        c2.alignment = Alignment(horizontal='center', vertical='center')
        c2.fill = PatternFill('solid', start_color='F9F9F9', end_color='F9F9F9')
        ws.row_dimensions[row+1].height = 20

    # Analyse auto
    row = 8
    ws.merge_cells(f'A{row}:H{row}')
    ws.cell(row, 1, "ANALYSE AUTOMATIQUE").font = title_font(12)
    ws.cell(row, 1).alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[row].height = 28

    sites_all = data.get('sites', [])
    lignes = analyse_auto(sites_all, "Toutes coordinations")
    for i, ligne in enumerate(lignes):
        r = row + 1 + i
        ws.merge_cells(f'A{r}:H{r}')
        c = ws.cell(r, 1, ligne)
        if ligne.startswith('📊') or ligne.startswith('💡'):
            c.font = Font(name='Arial', bold=True, size=10, color='1A1A1A')
            c.fill = PatternFill('solid', start_color='FFF3E0', end_color='FFF3E0')
        elif ligne.startswith('🏆') or ligne.startswith('✅'):
            c.font = Font(name='Arial', size=10, color='16a34a')
        elif ligne.startswith('⚠️') or ligne.startswith('📉') or ligne.startswith('   →'):
            c.font = Font(name='Arial', size=10, color='dc2626')
        else:
            c.font = normal_font()
        c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
        ws.row_dimensions[r].height = 18

    # Widths
    for i in range(1, 9):
        set_col_width(ws, i, 18)

def create_coordinations_sheet(wb, data):
    ws = wb.create_sheet("🏢 Par Coordination")
    ws.sheet_view.showGridLines = False
    coords = data.get('coordinations', [])

    # Titre
    ws.merge_cells('A1:G1')
    ws['A1'] = "STATISTIQUES PAR COORDINATION"
    ws['A1'].font = Font(name='Arial', bold=True, size=14, color='FFFFFF')
    ws['A1'].fill = PatternFill('solid', start_color='0077B6', end_color='0077B6')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 38

    headers = ['Rang', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux (%)', 'Statut']
    widths  = [8, 28, 14, 14, 14, 12, 18]
    write_header_row(ws, 2, headers, widths)

    # Tri par taux
    coords_sorted = sorted(coords, key=lambda c: c['tauxRetrait'], reverse=True)
    for i, coord in enumerate(coords_sorted):
        r   = i + 3
        t   = coord['tauxRetrait']
        alt = (i % 2 == 1)
        write_data_row(ws, r, [
            i + 1,
            coord['coordination'],
            coord['total'],
            coord['retires'],
            coord['restants'],
            fmt_taux(t),
            '🏆 Excellent' if t >= 75 else '📈 En progression' if t >= 50 else '⚠️ À améliorer',
        ], alt)
        # Couleur taux
        taux_cell = ws.cell(r, 6)
        taux_cell.font = Font(name='Arial', bold=True, size=10, color=taux_color(t))
        ws.row_dimensions[r].height = 20

    # Ligne totaux
    r = len(coords_sorted) + 3
    ws.merge_cells(f'A{r}:B{r}')
    ws.cell(r, 1, "TOTAL").font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
    ws.cell(r, 1).fill = PatternFill('solid', start_color='333333', end_color='333333')
    ws.cell(r, 1).alignment = Alignment(horizontal='center')
    for c, v in enumerate([
        sum(c['total'] for c in coords),
        sum(c['retires'] for c in coords),
        sum(c['restants'] for c in coords),
        fmt_taux(data['tauxRetrait']),
        '',
    ], 3):
        cell = ws.cell(r, c, v)
        cell.font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
        cell.fill = PatternFill('solid', start_color='333333', end_color='333333')
        cell.alignment = Alignment(horizontal='center')
        cell.border = cell_border()

    # Analyse
    row = r + 2
    ws.merge_cells(f'A{row}:G{row}')
    ws.cell(row, 1, "ANALYSE PAR COORDINATION").font = title_font(11)
    ws.cell(row, 1).alignment = Alignment(horizontal='left')
    sites_all = data.get('sites', [])
    for i, ligne in enumerate(analyse_auto(sites_all, "Toutes coordinations")):
        r2 = row + 1 + i
        ws.merge_cells(f'A{r2}:G{r2}')
        c = ws.cell(r2, 1, ligne)
        c.font = normal_font()
        c.alignment = Alignment(horizontal='left', indent=1)
        ws.row_dimensions[r2].height = 18

    # Graphique
    if coords_sorted:
        chart = BarChart()
        chart.type = "col"
        chart.title = "Retraits par coordination"
        chart.y_axis.title = "Cartes"
        chart.x_axis.title = "Coordination"
        chart.height = 12
        chart.width = 20
        chart.style = 10

        data_ref = Reference(ws, min_col=4, min_row=2, max_row=len(coords_sorted)+2)
        cats     = Reference(ws, min_col=2, min_row=3, max_row=len(coords_sorted)+2)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cats)

        ws.add_chart(chart, f"A{row + len(analyse_auto(sites_all,'')) + 3}")

def create_agences_sheet(wb, data):
    ws = wb.create_sheet("🏪 Par Agence")
    ws.sheet_view.showGridLines = False
    agences = data.get('agences', [])

    ws.merge_cells('A1:H1')
    ws['A1'] = "STATISTIQUES PAR AGENCE"
    ws['A1'].font = Font(name='Arial', bold=True, size=14, color='FFFFFF')
    ws['A1'].fill = PatternFill('solid', start_color='0d9488', end_color='0d9488')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 38

    headers = ['Rang', 'Agence', 'Coordination', 'Sites', 'Agents', 'Total', 'Retirées', 'Taux (%)']
    widths  = [8, 25, 22, 8, 8, 14, 14, 12]
    write_header_row(ws, 2, headers, widths)

    agences_sorted = sorted(agences, key=lambda a: a['taux_retrait'], reverse=True)
    for i, ag in enumerate(agences_sorted):
        r   = i + 3
        t   = ag['taux_retrait']
        write_data_row(ws, r, [
            i + 1,
            ag['agence_nom'],
            ag['coordination_nom'],
            ag['nombre_sites'],
            ag['nombre_agents'],
            ag['total_cartes'],
            ag['cartes_retirees'],
            fmt_taux(t),
        ], i % 2 == 1)
        ws.cell(r, 8).font = Font(name='Arial', bold=True, size=10, color=taux_color(t))
        ws.row_dimensions[r].height = 20

def create_sites_sheet(wb, data):
    ws = wb.create_sheet("📍 Par Site")
    ws.sheet_view.showGridLines = False
    sites = data.get('sites', [])

    ws.merge_cells('A1:H1')
    ws['A1'] = "STATISTIQUES DÉTAILLÉES PAR SITE"
    ws['A1'].font = Font(name='Arial', bold=True, size=14, color='FFFFFF')
    ws['A1'].fill = PatternFill('solid', start_color='7c3aed', end_color='7c3aed')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 38

    headers = ['Rang', 'Site', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux (%)', 'Statut']
    widths  = [8, 30, 22, 12, 12, 12, 10, 18]
    write_header_row(ws, 2, headers, widths)

    sites_sorted = sorted(sites, key=lambda s: s['tauxRetrait'], reverse=True)
    for i, site in enumerate(sites_sorted):
        r = i + 3
        t = site['tauxRetrait']
        write_data_row(ws, r, [
            i + 1,
            site['site'],
            site['coordination'],
            site['total'],
            site['retires'],
            site['restants'],
            fmt_taux(t),
            '🏆 Excellent' if t >= 75 else '📈 En progression' if t >= 50 else '⚠️ À améliorer',
        ], i % 2 == 1)
        ws.cell(r, 7).font = Font(name='Arial', bold=True, size=10, color=taux_color(t))
        ws.row_dimensions[r].height = 18

    # Totaux
    r = len(sites_sorted) + 3
    ws.merge_cells(f'A{r}:C{r}')
    ws.cell(r, 1, "TOTAL").font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
    ws.cell(r, 1).fill = PatternFill('solid', start_color='333333', end_color='333333')
    ws.cell(r, 1).alignment = Alignment(horizontal='center')
    for c, v in enumerate([
        f'=SUM(D3:D{r-1})',
        f'=SUM(E3:E{r-1})',
        f'=SUM(F3:F{r-1})',
        '',
        '',
    ], 4):
        cell = ws.cell(r, c, v)
        cell.font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
        cell.fill = PatternFill('solid', start_color='333333', end_color='333333')
        cell.alignment = Alignment(horizontal='center')
        cell.border = cell_border()

def create_recommandations_sheet(wb, data):
    ws = wb.create_sheet("💡 Recommandations")
    ws.sheet_view.showGridLines = False

    ws.merge_cells('A1:F1')
    ws['A1'] = "RECOMMANDATIONS ET ALERTES"
    ws['A1'].font = Font(name='Arial', bold=True, size=14, color='FFFFFF')
    ws['A1'].fill = PatternFill('solid', start_color='dc2626', end_color='dc2626')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 38

    sites  = data.get('sites', [])
    row    = 3

    # Alertes critiques
    alertes = sorted([s for s in sites if s['tauxRetrait'] < 50], key=lambda s: s['tauxRetrait'])
    ws.merge_cells(f'A{row}:F{row}')
    ws.cell(row, 1, f"⚠️ ALERTES CRITIQUES — {len(alertes)} site(s) avec taux < 50%").font = Font(name='Arial', bold=True, size=12, color='dc2626')
    ws.cell(row, 1).fill = PatternFill('solid', start_color='FEF2F2', end_color='FEF2F2')
    ws.cell(row, 1).alignment = Alignment(horizontal='left', indent=1)
    ws.row_dimensions[row].height = 26
    row += 1

    if alertes:
        write_header_row(ws, row, ['Site', 'Coordination', 'Total', 'Retirées', 'Restantes', 'Taux (%)'],
                         [30, 22, 12, 12, 12, 12])
        row += 1
        for i, s in enumerate(alertes):
            write_data_row(ws, row, [s['site'], s['coordination'], s['total'], s['retires'], s['restants'], fmt_taux(s['tauxRetrait'])], i % 2 == 1)
            ws.cell(row, 6).font = Font(name='Arial', bold=True, color='dc2626')
            ws.row_dimensions[row].height = 18
            row += 1

    row += 2
    # Top performers
    top10 = sorted(sites, key=lambda s: s['tauxRetrait'], reverse=True)[:10]
    ws.merge_cells(f'A{row}:F{row}')
    ws.cell(row, 1, f"🏆 TOP 10 PERFORMERS — Sites avec les meilleurs taux").font = Font(name='Arial', bold=True, size=12, color='16a34a')
    ws.cell(row, 1).fill = PatternFill('solid', start_color='F0FDF4', end_color='F0FDF4')
    ws.cell(row, 1).alignment = Alignment(horizontal='left', indent=1)
    ws.row_dimensions[row].height = 26
    row += 1
    write_header_row(ws, row, ['Rang', 'Site', 'Coordination', 'Total', 'Retirées', 'Taux (%)'],
                     [8, 30, 22, 12, 12, 12])
    row += 1
    for i, s in enumerate(top10):
        write_data_row(ws, row, [i+1, s['site'], s['coordination'], s['total'], s['retires'], fmt_taux(s['tauxRetrait'])], i % 2 == 1)
        ws.cell(row, 6).font = Font(name='Arial', bold=True, color='16a34a')
        ws.row_dimensions[row].height = 18
        row += 1

    row += 2
    # Recommandations textuelles
    ws.merge_cells(f'A{row}:F{row}')
    ws.cell(row, 1, "💡 RECOMMANDATIONS OPÉRATIONNELLES").font = title_font(12)
    ws.cell(row, 1).alignment = Alignment(horizontal='left', indent=1)
    ws.row_dimensions[row].height = 28
    row += 1

    taux_global = data['tauxRetrait']
    recs = []
    if taux_global >= 75:
        recs = [
            "✅ Performance globale excellente. Le système de distribution est efficace.",
            "→ Documenter et partager les meilleures pratiques des sites leaders (taux ≥ 90%).",
            "→ Mettre en place un programme de mentorat : les équipes des meilleurs sites accompagnent les sites en retard.",
            "→ Planifier les opérations de clôture pour les quelques cartes restantes.",
        ]
    elif taux_global >= 50:
        recs = [
            "📈 Performance satisfaisante mais des efforts sont encore nécessaires.",
            f"→ Priorité absolue : traiter les {len(alertes)} site(s) en alerte (taux < 50%).",
            "→ Renforcer les équipes mobiles sur les zones géographiquement difficiles d'accès.",
            "→ Intensifier la communication auprès des bénéficiaires qui n'ont pas encore retiré.",
            "→ Mettre en place un reporting hebdomadaire sur les sites en retard.",
        ]
    else:
        recs = [
            "🚨 Performance insuffisante — Action immédiate requise.",
            f"→ {len(alertes)} site(s) en alerte critique nécessitent une intervention d'urgence.",
            "→ Mobiliser des équipes supplémentaires et déployer des points de distribution additionnels.",
            "→ Lancer une campagne de sensibilisation ciblée (radio, SMS, annonces locales).",
            "→ Instaurer un comité de suivi quotidien avec rapports d'avancement.",
            "→ Identifier les blocages opérationnels (logistique, accessibilité, informations) et les résoudre sous 72h.",
        ]

    for rec in recs:
        ws.merge_cells(f'A{row}:F{row}')
        c = ws.cell(row, 1, rec)
        if rec.startswith('✅') or rec.startswith('📈') or rec.startswith('🚨'):
            c.font = Font(name='Arial', bold=True, size=10, color='1A1A1A')
            c.fill = PatternFill('solid', start_color='FFF3E0', end_color='FFF3E0')
        else:
            c.font = normal_font()
        c.alignment = Alignment(horizontal='left', indent=1, wrap_text=True)
        ws.row_dimensions[row].height = 20
        row += 1

    for i in range(1, 7):
        set_col_width(ws, i, 20)

def generate(data_str):
    data = json.loads(data_str)

    wb = Workbook()
    create_resume_sheet(wb, data)
    create_coordinations_sheet(wb, data)
    create_agences_sheet(wb, data)
    create_sites_sheet(wb, data)
    create_recommandations_sheet(wb, data)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()

if __name__ == '__main__':
    print(generate(sys.argv[1]))