"""The PDF report of an analysis run (ReportLab), built from ``ReportData`` only.

Every value from the repository (paths, titles, messages, names) is escaped before it reaches
ReportLab's paragraph markup, which would otherwise interpret tags such as <b> or <link>.
The built-in Helvetica fonts cover Windows-1252; other characters are replaced with "?" so
nothing renders as a missing glyph. Lists show the most important items and say how many
exist in total. Charts are drawn as vector shapes.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.reports.data import ReportData

APP_NAME = "CodeBase Analysis"
MAX_TEXT = 300  # characters of a message or explanation in a table cell
MARGIN = 18 * mm
WIDTH = A4[0] - 2 * MARGIN

INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#475569")
LINE = colors.HexColor("#cbd5e1")
HEAD = colors.HexColor("#e2e8f0")
ACCENT = colors.HexColor("#4f46e5")
SEVERITY_COLORS = {
    "critical": colors.HexColor("#b91c1c"),
    "high": colors.HexColor("#ea580c"),
    "medium": colors.HexColor("#ca8a04"),
    "low": colors.HexColor("#2563eb"),
    "info": colors.HexColor("#64748b"),
    "unknown": colors.HexColor("#64748b"),
}


def score_color(score: int | None) -> colors.Color:
    if score is None:
        return colors.HexColor("#94a3b8")
    if score >= 85:
        return colors.HexColor("#059669")
    if score >= 70:
        return colors.HexColor("#65a30d")
    if score >= 55:
        return colors.HexColor("#ca8a04")
    if score >= 40:
        return colors.HexColor("#ea580c")
    return colors.HexColor("#dc2626")


def text(value: Any, limit: int | None = None) -> str:
    """Plain text made safe for paragraph markup: printable, Windows-1252, escaped."""
    raw = "" if value is None else str(value)
    raw = "".join(c if c.isprintable() or c == "\n" else " " for c in raw)
    if limit is not None and len(raw) > limit:
        raw = raw[: limit - 1].rstrip() + "…"
    raw = raw.encode("cp1252", "replace").decode("cp1252")
    return escape(raw).replace("\n", "<br/>")


def number(value: Any) -> str:
    return f"{value:,}" if isinstance(value, int) else str(value)


def severity_label(level: str) -> str:
    """A severity in its color (unknown levels in the neutral one)."""
    color = SEVERITY_COLORS.get(level, SEVERITY_COLORS["unknown"]).hexval()[2:]
    return f'<font color="#{color}"><b>{text(level)}</b></font>'


def location(path: str, line: int | None) -> str:
    return f"{path}:{line}" if line else path


@dataclass(frozen=True)
class Built:
    content: bytes
    pages: int


class _Styles:
    def __init__(self) -> None:
        base = getSampleStyleSheet()
        self.body = ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=INK,
        )
        self.small = ParagraphStyle("small", parent=self.body, fontSize=7.5, leading=9.5)
        self.muted = ParagraphStyle("muted", parent=self.body, textColor=MUTED)
        self.cell = ParagraphStyle("cell", parent=self.body, fontSize=7.5, leading=9.5)
        self.cell_bold = ParagraphStyle("cell_bold", parent=self.cell, fontName="Helvetica-Bold")
        self.title = ParagraphStyle(
            "title",
            parent=self.body,
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            spaceAfter=4,
        )
        self.subtitle = ParagraphStyle(
            "subtitle", parent=self.body, fontSize=12, leading=16, textColor=MUTED
        )
        self.h1 = ParagraphStyle(
            "h1",
            parent=self.body,
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            spaceBefore=10,
            spaceAfter=6,
            textColor=ACCENT,
        )
        self.h2 = ParagraphStyle(
            "h2",
            parent=self.body,
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=14,
            spaceBefore=8,
            spaceAfter=4,
        )
        self.big = ParagraphStyle(
            "big",
            parent=self.body,
            fontName="Helvetica-Bold",
            fontSize=34,
            leading=38,
            alignment=TA_CENTER,
        )
        self.center = ParagraphStyle(
            "center", parent=self.body, alignment=TA_CENTER, textColor=MUTED
        )


def _table(
    rows: Sequence[Sequence[Any]], widths: Sequence[float], styles: _Styles, header: bool = True
) -> Table:
    """A table with wrapped cells; strings are wrapped in paragraphs (already escaped)."""

    def cell(value: Any, bold: bool) -> Any:
        if isinstance(value, str):
            return Paragraph(value, styles.cell_bold if bold else styles.cell)
        return value

    data = [[cell(v, header and i == 0) for v in row] for i, row in enumerate(rows)]
    table = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    table.hAlign = "LEFT"
    commands: list[Any] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), HEAD))
    table.setStyle(TableStyle(commands))
    return table


def _bars(
    items: Iterable[tuple[str, int | None, colors.Color]],
    maximum: int | None = None,
    width: float = WIDTH,
) -> Drawing:
    """Horizontal bars with a label and value each; a value of None reads "not scored"."""
    rows = list(items)
    row_height, label_width, value_width = 14, 110, 50
    drawing = Drawing(width, row_height * len(rows) + 4)
    top = max(maximum or 0, max((value or 0 for _, value, _ in rows), default=0), 1)
    bar_space = width - label_width - value_width
    for index, (label, value, color) in enumerate(rows):
        y = drawing.height - (index + 1) * row_height
        drawing.add(String(0, y + 3, label, fontName="Helvetica", fontSize=8, fillColor=INK))
        drawing.add(
            Rect(
                label_width,
                y + 1,
                bar_space,
                row_height - 4,
                fillColor=colors.HexColor("#f1f5f9"),
                strokeColor=None,
            )
        )
        if value:
            drawing.add(
                Rect(
                    label_width,
                    y + 1,
                    max(1.5, bar_space * value / top),
                    row_height - 4,
                    fillColor=color,
                    strokeColor=None,
                )
            )
        drawing.add(
            String(
                width - value_width + 6,
                y + 3,
                "not scored" if value is None else number(value),
                fontName="Helvetica-Bold",
                fontSize=8,
                fillColor=INK,
            )
        )
    return drawing


def _shown(total: int, shown: int, what: str) -> str:
    if total > shown:
        return f"The {shown:,} most important of {total:,} {what} are listed."
    return f"All {total:,} {what} are listed." if total else f"No {what}."


def _overview(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [
        Paragraph("Repository analysis report", s.title),
        Paragraph(f"{text(data.repository)} · project {text(data.project)}", s.subtitle),
        Spacer(1, 4 * mm),
        Paragraph(
            f"Analysis of {data.analyzed_at:%Y-%m-%d %H:%M} UTC · report generated {data.generated_at:%Y-%m-%d %H:%M} UTC"
            f" · run {data.run_id}",
            s.muted,
        ),
        Spacer(1, 6 * mm),
    ]
    facts = [
        ["Files in the repository", number(data.file_count)],
        ["Files analyzed", number(data.analyzed_file_count)],
        ["Excluded (dependencies, build output)", number(data.excluded_file_count)],
        ["Lines", number(data.total_lines)],
        ["Lines of code (non-blank)", number(data.code_lines)],
    ]
    if data.health is not None and data.health["overall"] is not None:
        score = data.health["overall"]
        badge = Table(
            [
                [
                    Paragraph(
                        f'<font color="#{score_color(score).hexval()[2:]}">{score}</font>', s.big
                    )
                ],
                [Paragraph(f"Code health score, grade {text(data.health['grade'])}", s.center)],
            ],
            colWidths=[55 * mm],
        )
        badge.setStyle(
            TableStyle([("BOX", (0, 0), (-1, -1), 0.5, LINE), ("TOPPADDING", (0, 0), (-1, -1), 6)])
        )
        layout = Table(
            [[_table(facts, [70 * mm, 35 * mm], s, header=False), badge]],
            colWidths=[WIDTH - 60 * mm, 60 * mm],
        )
        layout.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(layout)
    else:
        story.append(_table(facts, [70 * mm, 35 * mm], s, header=False))
    total = max(1, data.code_lines)
    languages = [entry for entry in data.languages if entry.get("code_lines")]
    if languages:
        story += [Paragraph("Languages", s.h2)]
        rows = [["Language", "Files", "Lines of code", "Share"]]
        rows += [
            [
                text(e["language"] or "Other"),
                number(e["files"]),
                number(e["code_lines"]),
                f"{100 * e['code_lines'] / total:.1f}%",
            ]
            for e in languages[:12]
        ]
        story.append(_table(rows, [60 * mm, 25 * mm, 35 * mm, 25 * mm], s))
    story += [
        Spacer(1, 6 * mm),
        Paragraph(
            "This report comes from static analysis: the code was read, never run. It lists what the"
            " analyses found; it cannot show that the project is free of bugs or vulnerabilities.",
            s.muted,
        ),
    ]
    return story


def _health_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Code health score", s.h1)]
    if data.health is None:
        return story + [
            Paragraph("This run was stored before the analyses the score uses.", s.muted)
        ]
    overall = data.health["overall"]
    story.append(
        Paragraph(
            f"Overall {overall if overall is not None else 'not scored'}"
            + (f"/100, grade {text(data.health['grade'])}" if overall is not None else "")
            + ": the weighted average of the dimensions that apply (grades: A from 85, B from 70,"
            " C from 55, D from 40, F below).",
            s.body,
        )
    )
    dimensions = data.health["dimensions"]
    story.append(Spacer(1, 2 * mm))
    story.append(
        _bars(((d["name"], d["score"], score_color(d["score"])) for d in dimensions), maximum=100)
    )
    rows = [["Dimension", "Score", "Weight", "How it was calculated"]]
    for d in dimensions:
        rows.append(
            [
                text(d["name"]),
                "not scored" if d["score"] is None else str(d["score"]),
                str(d["weight"]),
                text(d["explanation"], 600),
            ]
        )
    story += [Spacer(1, 2 * mm), _table(rows, [32 * mm, 18 * mm, 15 * mm, WIDTH - 65 * mm], s)]
    improvements = [(d["name"], item) for d in dimensions for item in d["improvements"]]
    if improvements:
        story.append(Paragraph("What would raise the score", s.h2))
        story += [
            Paragraph(f"• <b>{text(name)}</b>: {text(item)}", s.body) for name, item in improvements
        ]
    return story


def _security_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Security", s.h1)]
    summary = data.security
    if summary is None:
        return story + [Paragraph("This run was stored before security analysis existed.", s.muted)]
    severity = summary["by_severity"]
    confidence = summary["by_confidence"]
    story.append(
        Paragraph(
            f"{number(summary['findings'])} findings: {number(confidence.get('confirmed', 0))} confirmed,"
            f" {number(confidence.get('potential', 0))} potential. Bandit: {text(summary.get('bandit'))}."
            " Secret values are never shown.",
            s.body,
        )
    )
    story.append(
        _bars(
            (level.capitalize(), int(severity.get(level, 0)), SEVERITY_COLORS[level])
            for level in ("critical", "high", "medium", "low")
        )
    )
    owasp = {key: value for key, value in summary.get("by_owasp", {}).items() if value}
    if owasp:
        story.append(
            Paragraph(
                "OWASP Top 10 categories: "
                + text(", ".join(f"{k} {v:,}" for k, v in sorted(owasp.items()))),
                s.body,
            )
        )
    if data.findings:
        story.append(Paragraph("Most severe findings", s.h2))
        story.append(
            Paragraph(_shown(summary["findings"], len(data.findings), "findings"), s.muted)
        )
        rows = [["Severity", "Finding", "Location", "Fix"]]
        for f in data.findings:
            rows.append(
                [
                    f"{severity_label(f['severity'])}<br/>{text(f['confidence'])}",
                    text(f["title"])
                    + (
                        f"<br/>{text(f['owasp'])}" + (f", CWE-{f['cwe']}" if f["cwe"] else "")
                        if f["owasp"]
                        else ""
                    ),
                    text(location(f["path"], f["line"])),
                    text(f["recommendation"], MAX_TEXT),
                ]
            )
        story.append(_table(rows, [17 * mm, 50 * mm, 45 * mm, WIDTH - 112 * mm], s))
    return story


def _quality_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Code quality", s.h1)]
    summary = data.quality
    if summary is None:
        return story + [
            Paragraph("This run was stored before code-quality analysis existed.", s.muted)
        ]
    severity = summary["by_severity"]
    categories = {k: v for k, v in summary["by_category"].items() if v}
    story.append(
        Paragraph(
            f"{number(summary['issues'])} issues in {number(summary['files_analyzed'])} files;"
            f" {summary['duplication']['percent']}% of lines are duplicated. Ruff: {text(summary['ruff'])}.",
            s.body,
        )
    )
    story.append(
        _bars(
            (level.capitalize(), int(severity.get(level, 0)), SEVERITY_COLORS[level])
            for level in ("high", "medium", "low", "info")
        )
    )
    if categories:
        story.append(
            Paragraph(
                "By category: "
                + text(
                    ", ".join(f"{k.replace('_', ' ')} {v:,}" for k, v in sorted(categories.items()))
                ),
                s.body,
            )
        )
    if summary.get("top_files"):
        story.append(Paragraph("Files with the most issues", s.h2))
        rows = [["File", "Issues"]] + [
            [text(f["path"]), number(f["issues"])] for f in summary["top_files"][:10]
        ]
        story.append(_table(rows, [WIDTH - 25 * mm, 25 * mm], s))
    if data.issues:
        story.append(Paragraph("Most severe issues", s.h2))
        story.append(Paragraph(_shown(summary["issues"], len(data.issues), "issues"), s.muted))
        rows = [["Severity", "Rule", "Location", "Message"]]
        rows += [
            [
                severity_label(i["severity"]),
                text(i["rule_id"]),
                text(location(i["path"], i["line"])),
                text(i["message"], MAX_TEXT),
            ]
            for i in data.issues
        ]
        story.append(_table(rows, [17 * mm, 22 * mm, 55 * mm, WIDTH - 94 * mm], s))
    return story


def _complexity_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Complexity and maintainability", s.h1)]
    summary = data.complexity
    if summary is None:
        return story + [
            Paragraph("This run was stored before complexity analysis existed.", s.muted)
        ]
    ranks = summary["functions_by_rank"]
    index = summary.get("maintainability_index")
    story.append(
        Paragraph(
            f"{number(summary['functions'])} functions in {number(summary['files_measured'])} files;"
            f" average cyclomatic complexity {summary['average_cyclomatic']}, highest {number(summary['max_cyclomatic'])}."
            + (
                f" Maintainability index {index} (0-100; below 10 is poor)."
                if index is not None
                else ""
            ),
            s.body,
        )
    )
    story.append(
        _bars(
            [
                ("Low (1-10)", int(ranks.get("low", 0)), colors.HexColor("#059669")),
                ("Medium (11-20)", int(ranks.get("medium", 0)), colors.HexColor("#ca8a04")),
                ("High (21+)", int(ranks.get("high", 0)), colors.HexColor("#dc2626")),
            ]
        )
    )
    if data.functions:
        story.append(Paragraph("Most complex functions", s.h2))
        rows = [["Function", "Location", "Complexity", "Lines"]]
        rows += [
            [
                text(f["name"]),
                text(location(f["path"], f["line"])),
                number(f["cyclomatic"]),
                number(f["nloc"]),
            ]
            for f in data.functions
        ]
        story.append(_table(rows, [45 * mm, WIDTH - 95 * mm, 25 * mm, 25 * mm], s))
    if data.poor_files:
        story.append(Paragraph("Files with a poor maintainability index", s.h2))
        poor = int(summary["files_by_maintainability"].get("poor", 0))
        story.append(Paragraph(_shown(poor, len(data.poor_files), "files"), s.muted))
        rows = [["File", "Index", "Lines of code"]]
        rows += [
            [text(f["path"]), f"{f['maintainability_index']:.1f}", number(f["nloc"])]
            for f in data.poor_files
        ]
        story.append(_table(rows, [WIDTH - 50 * mm, 20 * mm, 30 * mm], s))
    return story


def _dependency_rows(records: list[dict[str, Any]], vulnerable: bool) -> list[list[str]]:
    rows = [["Package", "Version", "Vulnerabilities" if vulnerable else "Latest", "Declared in"]]
    for r in records:
        version = r["version"] or r["specifier"] or "-"
        if vulnerable:
            third = text(
                f"{r['vulnerability_count']}, worst {r['max_severity']}"
                + (f"; fixed in {r['fixed_in']}" if r["fixed_in"] else "")
            )
            if r["ids"]:
                third += "<br/>" + text(", ".join(r["ids"]))
        else:
            third = text(r["latest_version"] or "-")
        rows.append(
            [
                text(f"{r['name']} ({r['ecosystem']})"),
                text(version),
                third,
                text(location(r["manifest"], r["line"])),
            ]
        )
    return rows


def _dependencies_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Dependencies", s.h1)]
    summary = data.dependencies
    if summary is None:
        return story + [
            Paragraph("This run was stored before dependency analysis existed.", s.muted)
        ]
    updates = summary["updates"]
    lookups = summary["lookups"]
    story.append(
        Paragraph(
            f"{number(summary['dependencies'])} declared dependencies in {number(summary['manifests']['parsed'])} manifests;"
            f" {number(summary['vulnerable_dependencies'])} with known vulnerabilities ({number(summary['vulnerabilities'])} advisories);"
            f" {number(updates['major'])} a major version behind, {number(updates['minor'])} a minor version behind."
            f" Latest versions: {text(lookups['registry'])}; vulnerabilities (OSV.dev): {text(lookups['osv'])}.",
            s.body,
        )
    )
    if lookups["osv"] in ("disabled", "failed"):
        story.append(
            Paragraph(
                "Vulnerabilities were not looked up for this run, so none are listed.", s.muted
            )
        )
    if data.vulnerable:
        story.append(Paragraph("Vulnerable dependencies", s.h2))
        story.append(
            Paragraph(
                _shown(
                    summary["vulnerable_dependencies"],
                    len(data.vulnerable),
                    "vulnerable dependencies",
                ),
                s.muted,
            )
        )
        story.append(
            _table(
                _dependency_rows(data.vulnerable, True),
                [40 * mm, 25 * mm, WIDTH - 115 * mm, 50 * mm],
                s,
            )
        )
    if data.outdated:
        story.append(Paragraph("A major version behind", s.h2))
        story.append(
            Paragraph(_shown(updates["major"], len(data.outdated), "dependencies"), s.muted)
        )
        story.append(
            _table(
                _dependency_rows(data.outdated, False),
                [50 * mm, 30 * mm, 30 * mm, WIDTH - 110 * mm],
                s,
            )
        )
    if summary.get("conflicts"):
        story.append(
            Paragraph(
                "Declared with conflicting versions: "
                + text(", ".join(c["name"] for c in summary["conflicts"][:20])),
                s.body,
            )
        )
    return story


def _architecture_section(data: ReportData, s: _Styles) -> list[Any]:
    story: list[Any] = [Paragraph("Architecture", s.h1)]
    summary = data.architecture
    if summary is None:
        return story + [
            Paragraph("This run was stored before architecture analysis existed.", s.muted)
        ]
    story.append(
        Paragraph(
            f"{number(summary['components'])} components with {number(summary['edges'])} connections"
            f" ({number(summary['imports'])} imports), {number(summary['routes'])} API routes,"
            f" {number(summary['entry_points'])} entry points, {number(summary['cycles'])} dependency cycles.",
            s.body,
        )
    )
    if summary["technologies"]:
        story.append(
            Paragraph("<b>Technologies:</b> " + text(", ".join(summary["technologies"])), s.body)
        )
    if summary["data_stores"]:
        story.append(
            Paragraph("<b>Data stores:</b> " + text(", ".join(summary["data_stores"])), s.body)
        )
    document = data.document or {}
    cycles = document.get("cycles") or []
    if cycles:
        story.append(Paragraph("Dependency cycles", s.h2))
        story += [
            Paragraph(
                "• " + text(" <-> ".join(cycle) if len(cycle) == 2 else " -> ".join(cycle)), s.body
            )
            for cycle in cycles[:10]
        ]
        if len(cycles) > 10:
            story.append(Paragraph(f"and {len(cycles) - 10:,} more.", s.muted))
    observations = document.get("observations") or []
    if observations:
        story.append(Paragraph("Observations", s.h2))
        for o in observations:
            evidence = o.get("evidence") or []
            where = (
                (
                    "<br/>"
                    + text(", ".join(location(e["path"], e.get("line")) for e in evidence[:3]))
                )
                if evidence
                else ""
            )
            story.append(
                KeepTogether(
                    [
                        Paragraph(
                            f"<b>{text(o['title'])}</b>: {text(o['detail'], 600)}{where}", s.body
                        ),
                        Spacer(1, 1.5 * mm),
                    ]
                )
            )
    entry_points = document.get("entry_points") or []
    if entry_points:
        story.append(Paragraph("Entry points", s.h2))
        rows = [["Kind", "Location", "Detail"]]
        rows += [
            [
                text(e["kind"]),
                text(location(e["path"], e.get("line"))),
                text(e.get("detail"), MAX_TEXT),
            ]
            for e in entry_points[:15]
        ]
        story.append(_table(rows, [30 * mm, 60 * mm, WIDTH - 90 * mm], s))
    return story


def build_pdf(data: ReportData, *, compress: bool = True) -> Built:
    """The report as PDF bytes and its page count."""
    styles = _Styles()
    pages: list[int] = []

    def numbered(*args: Any, **kwargs: Any) -> Canvas:
        canvas = _NumberedCanvas(*args, **kwargs)
        canvas.header = f"{APP_NAME} · {data.repository}".encode("cp1252", "replace").decode(
            "cp1252"
        )
        canvas.generated = f"Generated {data.generated_at:%Y-%m-%d %H:%M} UTC"
        canvas.on_total = pages.append
        return canvas

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 4 * mm,
        bottomMargin=MARGIN,
        title=f"Analysis report: {data.repository}",
        author=APP_NAME,
        subject=f"Run {data.run_id}",
        pageCompression=1 if compress else 0,
        invariant=0 if compress else 1,
    )
    story = _overview(data, styles) + [PageBreak()]
    for section in (
        _health_section,
        _security_section,
        _quality_section,
        _complexity_section,
        _dependencies_section,
        _architecture_section,
    ):
        story += section(data, styles)
    document.build(story, canvasmaker=numbered)
    return Built(buffer.getvalue(), pages[-1] if pages else 0)


class _NumberedCanvas(Canvas):
    """Draws the header and "Page n of m" once the number of pages is known."""

    header = ""
    generated = ""
    on_total: Any = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._pages: list[dict[str, Any]] = []

    def showPage(self) -> None:  # noqa: N802 - ReportLab's API
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self._decorate(total)
            super().showPage()
        if self.on_total is not None:
            self.on_total(total)
        super().save()

    def _decorate(self, total: int) -> None:
        width, height = A4
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(MUTED)
        self.drawString(MARGIN, height - MARGIN + 2 * mm, self.header[:90])
        self.drawRightString(width - MARGIN, height - MARGIN + 2 * mm, self.generated)
        self.setStrokeColor(LINE)
        self.line(MARGIN, height - MARGIN, width - MARGIN, height - MARGIN)
        self.drawRightString(width - MARGIN, MARGIN - 6 * mm, f"Page {self._pageNumber} of {total}")
        self.restoreState()
