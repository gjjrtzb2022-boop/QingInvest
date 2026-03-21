#!/usr/bin/env python3
import argparse
import contextlib
import io
import json
import sys
from datetime import datetime, timedelta, timezone


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--codes", required=True)
    args = parser.parse_args()

    raw_codes = [item.strip() for item in args.codes.split(",") if item.strip()]
    target_codes = {normalize_code(item) for item in raw_codes}
    if not target_codes:
        print(json.dumps({"ok": True, "provider": "akshare", "quotes": []}))
        return 0

    try:
        import akshare as ak
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"akshare-import:{type(exc).__name__}:{exc}"}))
        return 2

    methods = [
        ("stock_zh_a_spot_em", lambda: ak.stock_zh_a_spot_em()),
        ("stock_zh_a_spot", lambda: ak.stock_zh_a_spot()),
    ]

    errors: list[str] = []
    for method_name, loader in methods:
        try:
            sink = io.StringIO()
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                df = loader()
            quotes = extract_quotes(df, target_codes)
            if quotes:
                print(json.dumps({"ok": True, "provider": f"akshare:{method_name}", "quotes": quotes}))
                return 0
            errors.append(f"{method_name}:empty")
        except Exception as exc:
            errors.append(f"{method_name}:{type(exc).__name__}:{exc}")

    print(json.dumps({"ok": False, "error": ";".join(errors)}))
    return 2


def extract_quotes(df, target_codes: set[str]) -> list[dict]:
    columns = list(df.columns)
    code_col = pick_column(columns, ["代码", "股票代码", "symbol", "code"])
    price_col = pick_column(columns, ["最新价", "最新", "现价", "price"])
    change_col = pick_column(columns, ["涨跌幅", "涨跌幅(%)", "change_percent"])
    pe_col = pick_column(columns, ["市盈率-动态", "市盈率", "pe", "PE"])
    pb_col = pick_column(columns, ["市净率", "pb", "PB"])
    market_cap_col = pick_column(columns, ["总市值", "总市值(元)", "market_cap"])

    if not code_col or not price_col:
        return []

    now_iso = datetime.now(timezone(timedelta(hours=8))).replace(microsecond=0).isoformat()
    quotes: list[dict] = []

    records = df.to_dict(orient="records")
    for row in records:
        code_raw = str(row.get(code_col, "")).strip()
        code = normalize_code(code_raw)
        if code not in target_codes:
            continue

        latest_price = to_float(row.get(price_col))
        if latest_price is None:
            continue

        quote = {
            "code": code,
            "latest_price": latest_price,
            "change_percent": to_float(row.get(change_col)) if change_col else None,
            "latest_pe": to_float(row.get(pe_col)) if pe_col else None,
            "latest_pb": to_float(row.get(pb_col)) if pb_col else None,
            "market_cap": to_float(row.get(market_cap_col)) if market_cap_col else None,
            "updated_at": now_iso,
        }
        quotes.append(quote)

    return quotes


def pick_column(columns: list[str], candidates: list[str]) -> str | None:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    return None


def normalize_code(value: str) -> str:
    return value.strip().split(".")[0]


def to_float(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if text in {"", "-", "--", "None", "nan", "NaN"}:
        return None
    try:
        output = float(text)
    except Exception:
        return None
    if output != output:
        return None
    return output


if __name__ == "__main__":
    raise SystemExit(main())
