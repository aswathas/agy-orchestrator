#!/usr/bin/env python3
"""
Renders WHITEPAPER.md into a publication-grade multi-page PDF at docs/WHITEPAPER.pdf
using PyMuPDF (fitz.Story + HTML/CSS layout engine).
"""
import os
import re
import html
import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD_PATH = os.path.join(ROOT, "WHITEPAPER.md")
PDF_PATH = os.path.join(ROOT, "docs", "WHITEPAPER.pdf")


def markdown_to_styled_html(md_text: str) -> str:
    lines = md_text.splitlines()
    out = []
    in_code = False
    in_list = False
    in_table = False

    for line in lines:
        if line.strip().startswith("```"):
            if not in_code:
                if in_list:
                    out.append("</ul>")
                    in_list = False
                in_code = True
                out.append('<pre class="codeblock">')
            else:
                in_code = False
                out.append("</pre>")
            continue

        if in_code:
            out.append(html.escape(line))
            continue

        stripped = line.strip()
        if not stripped:
            if in_list:
                out.append("</ul>")
                in_list = False
            if in_table:
                out.append("</table>")
                in_table = False
            continue

        # Table rows
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(re.match(r"^:?-+:?$", c) for c in cells):
                continue
            if not in_table:
                if in_list:
                    out.append("</ul>")
                    in_list = False
                in_table = True
                out.append('<table border="1" cellspacing="0" cellpadding="4">')
                out.append("<tr>" + "".join(f"<th><b>{html.escape(c)}</b></th>" for c in cells) + "</tr>")
            else:
                out.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in cells) + "</tr>")
            continue
        elif in_table:
            out.append("</table>")
            in_table = False

        if stripped == "---":
            out.append("<hr/>")
            continue

        # Headings
        if stripped.startswith("# "):
            out.append(f"<h1>{html.escape(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            out.append(f"<h2>{html.escape(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            out.append(f"<h3>{html.escape(stripped[4:])}</h3>")
        elif stripped.startswith("- ") or re.match(r"^\d+\.\s+", stripped):
            if not in_list:
                in_list = True
                out.append("<ul>")
            item_txt = re.sub(r"^(?:-\s+|\d+\.\s+)", "", stripped)
            item_txt = html.escape(item_txt)
            item_txt = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", item_txt)
            item_txt = re.sub(r"`([^`]+)`", r"<code>\1</code>", item_txt)
            out.append(f"<li>{item_txt}</li>")
        else:
            p_txt = html.escape(stripped)
            p_txt = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", p_txt)
            p_txt = re.sub(r"`([^`]+)`", r"<code>\1</code>", p_txt)
            out.append(f"<p>{p_txt}</p>")

    if in_list:
        out.append("</ul>")
    if in_table:
        out.append("</table>")
    if in_code:
        out.append("</pre>")

    body = "\n".join(out)
    return f"""
    <html>
    <head>
      <style>
        body {{
          font-family: sans-serif;
          font-size: 9.5pt;
          line-height: 1.38;
          color: #111111;
        }}
        h1 {{
          font-size: 17pt;
          color: #0A0A0A;
          border-bottom: 2px solid #E61919;
          padding-bottom: 4pt;
          margin-top: 10pt;
          margin-bottom: 8pt;
        }}
        h2 {{
          font-size: 13pt;
          color: #E61919;
          margin-top: 12pt;
          margin-bottom: 5pt;
        }}
        h3 {{
          font-size: 10.5pt;
          color: #111111;
          margin-top: 8pt;
          margin-bottom: 4pt;
        }}
        p {{
          margin-top: 3pt;
          margin-bottom: 5pt;
        }}
        ul {{
          margin-top: 3pt;
          margin-bottom: 6pt;
        }}
        li {{
          margin-bottom: 3pt;
        }}
        code {{
          font-family: monospace;
          font-size: 8.5pt;
          background-color: #F2F2F2;
        }}
        pre.codeblock {{
          font-family: monospace;
          font-size: 7.5pt;
          background-color: #F4F4F0;
          padding: 6pt;
          margin-top: 4pt;
          margin-bottom: 6pt;
          white-space: pre-wrap;
        }}
        table {{
          width: 100%;
          font-size: 8pt;
          margin-top: 6pt;
          margin-bottom: 8pt;
        }}
        th {{
          background-color: #EAE8E3;
          text-align: left;
        }}
      </style>
    </head>
    <body>
    {body}
    </body>
    </html>
    """


def build_pdf():
    os.makedirs(os.path.dirname(PDF_PATH), exist_ok=True)
    with open(MD_PATH, "r", encoding="utf-8") as f:
        md_text = f.read()

    styled_html = markdown_to_styled_html(md_text)
    story = fitz.Story(html=styled_html)
    writer = fitz.DocumentWriter(PDF_PATH)

    mediabox = fitz.paper_rect("a4")
    where = mediabox + (36, 42, -36, -42)

    more = True
    page_num = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
        page_num += 1

    writer.close()

    # Stamp header & footer on each page
    doc = fitz.open(PDF_PATH)
    total = len(doc)
    for idx, page in enumerate(doc):
        header_text = "ORCH // AGY MULTI-SURFACE & DUAL-CATEGORY HARNESS — TECHNICAL WHITEPAPER"
        footer_text = f"Author: Aswath (aswathas)  |  Zero-API-Key Agentic Harness  |  Page {idx + 1} of {total}"
        page.insert_text((36, 26), header_text, fontsize=7.5, color=(0.45, 0.45, 0.45))
        page.draw_line((36, 30), (mediabox.width - 36, 30), color=(0.9, 0.1, 0.1), width=0.6)
        page.draw_line((36, mediabox.height - 32), (mediabox.width - 36, mediabox.height - 32), color=(0.8, 0.8, 0.8), width=0.5)
        page.insert_text((36, mediabox.height - 20), footer_text, fontsize=7.5, color=(0.45, 0.45, 0.45))

    tmp_out = PDF_PATH + ".tmp"
    doc.save(tmp_out, deflate=True)
    doc.close()
    os.replace(tmp_out, PDF_PATH)
    print(f"Generated {PDF_PATH} ({total} pages, {os.path.getsize(PDF_PATH)} bytes)")


if __name__ == "__main__":
    build_pdf()
