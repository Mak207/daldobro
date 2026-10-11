#!/usr/bin/env python3
"""DalDobro canonical public sitemap generator (Git-root-safe).

Restores only already published, locally validated product landing pages.
Does not fetch APIs, change pricing, login, personal data or service code.
Used by GitHub source release guard; deterministic and idempotent.
"""
from __future__ import annotations
import argparse
import html
import json
import os
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITEMAP = ROOT / "sitemap.xml"
NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
PREFIX = "https://daldobro.ru/rastamozhka/"
XML_URL = "https://daldobro.ru/"
PRIVATE_PREFIXES = ("/api/", "/login", "/lk", "/admin", "/account", "/pay/")


def verify_product_page(path: Path) -> str:
    if not path.name.endswith(".html") or path.name == "index.html":
        raise ValueError("not_product_page")
    if not re.fullmatch(r"[a-z0-9-]+\.html", path.name):
        raise ValueError("product_filename_not_canonical:" + path.name)
    text = path.read_text(encoding="utf-8")
    if len(text) < 10000:
        raise ValueError("product_page_unexpectedly_short:" + path.name)
    expected = PREFIX + path.name
    can = re.search(
        r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)',
        text, flags=re.I,
    )
    if not can or html.unescape(can.group(1)) != expected:
        raise ValueError("canonical_mismatch:" + path.name)
    if not re.search(r'<h1(?:\s|>)', text, flags=re.I):
        raise ValueError("h1_missing:" + path.name)
    title = re.search(r'<title[^>]*>(.*?)</title>', text, flags=re.I | re.S)
    if not title:
        raise ValueError("title_missing:" + path.name)
    if "noindex" in text[:5000].lower():
        raise ValueError("noindex_on_product:" + path.name)
    return html.unescape(re.sub(r"\s+", " ", title.group(1))).strip()


def build_bytes() -> tuple[bytes, dict]:
    if not SITEMAP.is_file():
        raise RuntimeError("source_sitemap_missing")
    tree = ET.fromstring(SITEMAP.read_bytes())
    prefix = "{%s}" % NAMESPACE
    if tree.tag != prefix + "urlset":
        raise RuntimeError("sitemap_not_a_urlset")
    ET.register_namespace("", NAMESPACE)
    old = {}
    for item in tree.findall(prefix + "url"):
        url = item.findtext(prefix + "loc")
        if not url or not url.startswith(XML_URL):
            raise RuntimeError("unexpected_sitemap_host")
        path = url[len("https://daldobro.ru"):]
        if path.startswith(PRIVATE_PREFIXES):
            raise RuntimeError("private_page_in_sitemap:" + path[:60])
        if url not in old:
            old[url] = item
        else:
            raise RuntimeError("duplicate_existing_sitemap_loc")
    # Existing general/evergreen URLs stay intact; product entries are rebuilt
    # from actual HTML files, not from a stale numeric target or synthetic URLs.
    nonproduct = {
        url: item for url, item in old.items()
        if not (url.startswith(PREFIX) and url.endswith(".html"))
    }
    if len(nonproduct) < 14:
        raise RuntimeError("expected_14_published_core_urls_missing")
    product_files = sorted(
        path for path in (ROOT / "rastamozhka").glob("*.html")
        if path.name != "index.html"
    )
    if len(product_files) < 180:
        raise RuntimeError("product_corpus_dropped_below_verified_threshold")
    titles = []
    for path in product_files:
        titles.append(verify_product_page(path))
    if len(set(titles)) != len(titles):
        raise RuntimeError("duplicate_product_titles")
    new_tree = ET.Element(prefix + "urlset")
    for url in sorted(nonproduct):
        new_tree.append(nonproduct[url])
    for path in product_files:
        node = ET.SubElement(new_tree, prefix + "url")
        ET.SubElement(node, prefix + "loc").text = PREFIX + path.name
    urls = [
        n.text for n in new_tree.findall(".//" + prefix + "loc")
        if n.text
    ]
    if len(urls) != len(set(urls)):
        raise RuntimeError("resulting_sitemap_duplicates")
    content = (b'<?xml version="1.0" encoding="UTF-8"?>\n'
               + ET.tostring(new_tree, encoding="utf-8") + b"\n")
    ET.fromstring(content)
    return content, {
        "status": "VALIDATED_PUBLIC_PAGES",
        "core_urls": len(nonproduct),
        "product_urls": len(product_files),
        "total_urls": len(urls),
        "private_url_count": 0,
    }


def run(check_only: bool = False) -> dict:
    content, metrics = build_bytes()
    before = SITEMAP.read_bytes()
    metrics["modified"] = before != content
    metrics["check_only"] = check_only
    if check_only:
        metrics["status"] = "PASS" if before == content else "OUT_OF_SYNC"
        return metrics
    if before != content:
        # Same-directory atomic replacement, no symlink or external filesystem.
        fd, temporary = tempfile.mkstemp(prefix=".sitemap.", suffix=".xml.tmp",
                                        dir=str(SITEMAP.parent))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary, SITEMAP)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return metrics


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    result = run(check_only=args.check)
    print(json.dumps(result, ensure_ascii=False))
    if result["status"] == "OUT_OF_SYNC":
        raise SystemExit(2)
