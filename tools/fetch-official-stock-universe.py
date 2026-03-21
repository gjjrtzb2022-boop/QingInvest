#!/usr/bin/env python3
import json
from io import BytesIO

import pandas as pd
import requests


def main() -> int:
    warnings = []
    items = []

    try:
        items.extend(fetch_sse("主板A股"))
        items.extend(fetch_sse("科创板"))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"sse:{type(exc).__name__}:{exc}"}, ensure_ascii=False))
        return 2

    try:
        items.extend(fetch_szse_a())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"szse:{type(exc).__name__}:{exc}"}, ensure_ascii=False))
        return 2

    try:
        bj_items = fetch_bse_placeholder()
        if bj_items:
            items.extend(bj_items)
        else:
            warnings.append("bse-list-unavailable")
    except Exception as exc:
        warnings.append(f"bse:{type(exc).__name__}:{exc}")

    deduped = []
    seen = set()
    for item in items:
        code = item.get("code", "")
        if not code or code in seen:
            continue
        seen.add(code)
        deduped.append(item)

    deduped.sort(key=lambda row: row["code"])
    print(
        json.dumps(
            {
                "ok": True,
                "provider": "official-exchange-mixed",
                "warnings": warnings,
                "stocks": deduped,
            },
            ensure_ascii=False,
        )
    )
    return 0


def fetch_sse(symbol: str) -> list[dict]:
    indicator_map = {"主板A股": "1", "科创板": "8"}
    params = {
        "STOCK_TYPE": indicator_map[symbol],
        "REG_PROVINCE": "",
        "CSRC_CODE": "",
        "STOCK_CODE": "",
        "sqlId": "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
        "COMPANY_STATUS": "2,4,5,7,8",
        "type": "inParams",
        "isPagination": "true",
        "pageHelp.cacheSize": "1",
        "pageHelp.beginPage": "1",
        "pageHelp.pageSize": "10000",
        "pageHelp.pageNo": "1",
        "pageHelp.endPage": "1",
    }
    headers = {
        "Host": "query.sse.com.cn",
        "Referer": "https://www.sse.com.cn/assortment/stock/list/share/",
        "User-Agent": "Mozilla/5.0",
    }
    response = requests.get(
        "https://query.sse.com.cn/sseQuery/commonQuery.do",
        params=params,
        headers=headers,
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("result", [])
    output = []
    for row in rows:
        code = str(row.get("A_STOCK_CODE", "")).strip().zfill(6)
        if len(code) != 6:
            continue
        output.append(
            {
                "symbol": f"{code}.SH",
                "code": code,
                "name": str(row.get("SEC_NAME_CN", "")).strip(),
                "exchange": "SH",
                "market": "CN",
                "board": "科创板" if symbol == "科创板" else "上证主板",
                "industry_name": str(row.get("CSRC_CODE_DESC", "")).strip(),
                "secid": f"1.{code}",
                "listing_status": "listed",
                "is_active": True,
                "listed_at": normalize_date(row.get("LIST_DATE")),
                "latest_price": None,
                "change_percent": None,
                "change_amount": None,
                "turnover_rate": None,
                "volume_ratio": None,
                "dynamic_pe": None,
                "pb_ratio": None,
                "dividend_yield": None,
                "total_market_cap": None,
                "float_market_cap": None,
                "latest_snapshot_at": None,
                "metadata": {
                    "source": "sse-official",
                    "company_full_name": str(row.get("FULL_NAME", "")).strip(),
                    "company_abbr": str(row.get("COMPANY_ABBR", "")).strip(),
                    "product_status": str(row.get("PRODUCT_STATUS", "")).strip(),
                },
            }
        )
    return output


def fetch_szse_a() -> list[dict]:
    params = {
        "SHOWTYPE": "xlsx",
        "CATALOGID": "1110",
        "TABKEY": "tab1",
        "random": "0.6935816432433362",
    }
    headers = {
        "Referer": "https://www.szse.cn/market/product/stock/list/index.html",
        "User-Agent": "Mozilla/5.0",
    }
    response = requests.get("https://www.szse.cn/api/report/ShowReport", params=params, headers=headers, timeout=25)
    response.raise_for_status()
    df = pd.read_excel(BytesIO(response.content))
    records = []
    for _, row in df.iterrows():
        code = normalize_code(row.get("A股代码"))
        if not code:
            continue
        board = str(row.get("板块", "")).strip() or ("创业板" if code.startswith(("300", "301")) else "深证主板")
        industry = str(row.get("所属行业", "")).strip()
        records.append(
            {
                "symbol": f"{code}.SZ",
                "code": code,
                "name": str(row.get("A股简称", "")).strip(),
                "exchange": "SZ",
                "market": "CN",
                "board": board,
                "industry_name": industry,
                "secid": f"0.{code}",
                "listing_status": "listed",
                "is_active": True,
                "listed_at": normalize_date(row.get("A股上市日期")),
                "latest_price": None,
                "change_percent": None,
                "change_amount": None,
                "turnover_rate": None,
                "volume_ratio": None,
                "dynamic_pe": None,
                "pb_ratio": None,
                "dividend_yield": None,
                "total_market_cap": None,
                "float_market_cap": None,
                "latest_snapshot_at": None,
                "metadata": {
                    "source": "szse-official",
                    "board_raw": str(row.get("板块", "")).strip(),
                    "total_shares": to_float(row.get("A股总股本")),
                    "float_shares": to_float(row.get("A股流通股本")),
                },
            }
        )
    return records


def fetch_bse_placeholder() -> list[dict]:
    return []


def normalize_code(value) -> str:
    if value is None:
        return ""
    text = str(value).strip().split(".")[0]
    return text.zfill(6) if text.isdigit() else ""


def normalize_date(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    try:
        ts = pd.to_datetime(text)
    except Exception:
        return None
    if pd.isna(ts):
        return None
    return ts.strftime("%Y-%m-%d")


def to_float(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text.lower() in {"nan", "none", "--", "-"}:
        return None
    try:
        return float(text)
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
