from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import math
import sys
import traceback
import urllib.error
import urllib.request
from typing import Any

import pandas as pd
import yfinance as yf


SOURCE = "Yahoo Finance via yfinance"
SYMBOLS = [
    {"symbol": "BBCA", "name": "Bank Central Asia", "sector": "Keuangan"},
    {"symbol": "BBRI", "name": "Bank Rakyat Indonesia", "sector": "Keuangan"},
    {"symbol": "BMRI", "name": "Bank Mandiri", "sector": "Keuangan"},
    {"symbol": "BBNI", "name": "Bank Negara Indonesia", "sector": "Keuangan"},
    {"symbol": "TLKM", "name": "Telkom Indonesia", "sector": "Infrastruktur"},
    {"symbol": "ASII", "name": "Astra International", "sector": "Konsumer"},
    {"symbol": "ANTM", "name": "Aneka Tambang", "sector": "Bahan baku"},
    {"symbol": "ADRO", "name": "Alamtri Resources Indonesia", "sector": "Energi"},
    {"symbol": "ICBP", "name": "Indofood CBP Sukses Makmur", "sector": "Konsumer"},
    {"symbol": "INDF", "name": "Indofood Sukses Makmur", "sector": "Konsumer"},
    {"symbol": "UNTR", "name": "United Tractors", "sector": "Industri"},
    {"symbol": "PGAS", "name": "Perusahaan Gas Negara", "sector": "Energi"},
    {"symbol": "BRIS", "name": "Bank Syariah Indonesia", "sector": "Keuangan"},
    {"symbol": "GOTO", "name": "GoTo Gojek Tokopedia", "sector": "Teknologi"},
    {"symbol": "PTBA", "name": "Bukit Asam", "sector": "Energi"},
    {"symbol": "MDKA", "name": "Merdeka Copper Gold", "sector": "Bahan baku"},
]
SYMBOL_MAP = {item["symbol"]: item for item in SYMBOLS}


class NoDataAvailableError(Exception):
    pass


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def history_for(symbol: str, period: str) -> pd.DataFrame:
    frame = yf.download(
        f"{symbol}.JK",
        period=period,
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
        timeout=25,
        multi_level_index=False,
    )
    if frame is None or frame.empty:
        raise NoDataAvailableError(f"Yahoo Finance returned no daily OHLCV rows for {symbol}.JK.")

    if isinstance(frame.columns, pd.MultiIndex):
        close_columns = [column for column in frame.columns if column[0] == "Close"]
        if close_columns:
            ticker_frame = frame.xs(close_columns[0][1], axis=1, level=1, drop_level=True)
            if isinstance(ticker_frame, pd.Series):
                ticker_frame = ticker_frame.to_frame(name="Close")
            frame = ticker_frame

    required = ["Open", "High", "Low", "Close", "Volume"]
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise ValueError(f"Yahoo Finance response for {symbol}.JK is missing columns: {', '.join(missing)}.")

    return frame.dropna(subset=required).sort_index()


def error_text(error: BaseException) -> str:
    text = str(error).strip()
    return text if text else traceback.format_exception_only(type(error), error)[-1].strip()


def date_label(index_value: Any) -> str:
    stamp = pd.Timestamp(index_value)
    if stamp.tzinfo is not None:
        stamp = stamp.tz_convert(None)
    return stamp.strftime("%Y-%m-%d")


def freshness_for(last_date: str) -> str:
    last_day = dt.date.fromisoformat(last_date)
    if (dt.datetime.now(dt.timezone.utc).date() - last_day).days > 4:
        return "delayed"
    return "available"


def criterion(state: str, value: float | None, target: float | None, description: str) -> dict[str, Any]:
    return {"state": state, "value": value, "target": target, "description": description}


def unavailable_criteria(reason: str) -> dict[str, Any]:
    return {
        "breakout": criterion("unavailable", None, None, reason),
        "volume": criterion("unavailable", None, None, reason),
        "macd": criterion("unavailable", None, None, reason),
        "turnover": criterion("unavailable", None, 1_000_000_000, reason),
    }


def scan_one(item: dict[str, str]) -> dict[str, Any]:
    symbol = item["symbol"]
    retrieved_at = now_iso()
    try:
        frame = history_for(symbol, "3mo")

        last = frame.iloc[-1]
        close = finite_number(last["Close"])
        previous_close = finite_number(frame.iloc[-2]["Close"]) if len(frame) >= 2 else None
        if close is None:
            raise ValueError(f"Yahoo Finance returned a non-numeric closing price for {symbol}.JK.")

        last_date = date_label(frame.index[-1])
        change = close - previous_close if previous_close is not None else None
        turnover = frame["Close"].astype(float) * frame["Volume"].astype(float)
        enough_history = len(frame) >= 21
        if enough_history:
            previous_20 = frame.iloc[-21:-1]
            reference_high = finite_number(previous_20["High"].max())
            average_volume = finite_number(previous_20["Volume"].mean())
            average_turnover = finite_number(turnover.iloc[-21:-1].mean())
        else:
            reference_high = None
            average_volume = None
            average_turnover = None

        closes = frame["Close"].astype(float)
        macd_line = closes.ewm(span=12, adjust=False).mean() - closes.ewm(span=26, adjust=False).mean()
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        histogram = macd_line - signal_line
        macd_ready = len(frame) >= 35

        if enough_history:
            breakout_pass = bool(close > reference_high)
            volume_target = average_volume * 1.5 if average_volume is not None else None
            volume_pass = bool(float(last["Volume"]) >= volume_target) if volume_target is not None else False
            turnover_pass = bool(average_turnover >= 1_000_000_000) if average_turnover is not None else False
            breakout = criterion(
                "pass" if breakout_pass else "fail",
                close,
                reference_high,
                "Penutupan > high tertinggi 20 hari sebelumnya",
            )
            volume = criterion(
                "pass" if volume_pass else "fail",
                finite_number(last["Volume"]),
                volume_target,
                "Volume hari ini ≥ 1,5× rata-rata 20 hari sebelumnya",
            )
            turnover_criterion = criterion(
                "pass" if turnover_pass else "fail",
                average_turnover,
                1_000_000_000,
                "Rata-rata nilai transaksi 20 hari ≥ Rp1 miliar",
            )
        else:
            reason = f"Riwayat hanya {len(frame)} hari; perlu minimal 21 sesi untuk kriteria 20 hari."
            breakout = criterion("unavailable", None, None, reason)
            volume = criterion("unavailable", None, None, reason)
            turnover_criterion = criterion("unavailable", None, 1_000_000_000, reason)

        if macd_ready:
            macd_value = finite_number(macd_line.iloc[-1])
            signal_value = finite_number(signal_line.iloc[-1])
            histogram_value = finite_number(histogram.iloc[-1])
            prior_histogram = finite_number(histogram.iloc[-2])
            macd_pass = (
                macd_value is not None
                and signal_value is not None
                and histogram_value is not None
                and prior_histogram is not None
                and macd_value > signal_value
                and histogram_value > prior_histogram
            )
            macd_criterion = criterion(
                "pass" if macd_pass else "fail",
                histogram_value,
                prior_histogram,
                "MACD > signal dan histogram lebih tinggi dari hari sebelumnya",
            )
        else:
            macd_criterion = criterion(
                "unavailable",
                None,
                None,
                f"Riwayat hanya {len(frame)} hari; perlu minimal 35 sesi untuk MACD 26/9.",
            )

        return {
            "symbol": symbol,
            "name": item["name"],
            "state": freshness_for(last_date),
            "error": None,
            "open": finite_number(last["Open"]),
            "high": finite_number(last["High"]),
            "low": finite_number(last["Low"]),
            "close": close,
            "change": change,
            "changePercent": (
                (change / previous_close * 100)
                if change is not None and previous_close
                else None
            ),
            "volume": int(last["Volume"]),
            "averageTurnover": average_turnover,
            "lastTradingDate": last_date,
            "updatedAt": retrieved_at,
            "criteria": {
                "breakout": breakout,
                "volume": volume,
                "macd": macd_criterion,
                "turnover": turnover_criterion,
            },
        }
    except Exception as error:
        return {
            "symbol": symbol,
            "name": item["name"],
            "state": "unavailable" if isinstance(error, NoDataAvailableError) else "failed",
            "error": error_text(error),
            "open": None,
            "high": None,
            "low": None,
            "close": None,
            "change": None,
            "changePercent": None,
            "volume": None,
            "averageTurnover": None,
            "lastTradingDate": None,
            "updatedAt": retrieved_at,
            "criteria": unavailable_criteria("Data tidak tersedia; kriteria tidak dapat dihitung."),
        }


def scanner() -> dict[str, Any]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(scan_one, item) for item in SYMBOLS]
        stocks = [future.result() for future in futures]

    states = [stock["state"] for stock in stocks]
    if any(state == "delayed" for state in states):
        state = "delayed"
    elif any(state == "available" for state in states):
        state = "available"
    elif any(state == "unavailable" for state in states):
        state = "unavailable"
    elif any(stock["error"] for stock in stocks):
        state = "failed"
    else:
        state = "unavailable"

    return {"source": SOURCE, "updatedAt": now_iso(), "state": state, "stocks": stocks}


def swing_levels(frame: pd.DataFrame, column: str, mode: str, close: float) -> list[dict[str, Any]]:
    values = frame[column].astype(float).tolist()
    levels: list[dict[str, Any]] = []
    for index in range(2, len(values) - 2):
        window = values[index - 2 : index + 3]
        current = values[index]
        is_swing = current == (min(window) if mode == "support" else max(window))
        if is_swing and (current < close if mode == "support" else current > close):
            levels.append({"price": current, "date": date_label(frame.index[index])})
    levels.sort(key=lambda level: abs(level["price"] - close))
    return levels[:3]


def stock_detail(symbol: str) -> dict[str, Any]:
    item = SYMBOL_MAP[symbol]
    retrieved_at = now_iso()
    try:
        frame = history_for(symbol, "6mo")

        close_series = frame["Close"].astype(float)
        macd_line = close_series.ewm(span=12, adjust=False).mean() - close_series.ewm(span=26, adjust=False).mean()
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        histogram = macd_line - signal_line
        candles = []
        for index, row in enumerate(frame.itertuples()):
            candles.append(
                {
                    "date": date_label(frame.index[index]),
                    "open": finite_number(row.Open),
                    "high": finite_number(row.High),
                    "low": finite_number(row.Low),
                    "close": finite_number(row.Close),
                    "volume": int(row.Volume),
                    "macd": finite_number(macd_line.iloc[index]) if index >= 25 else None,
                    "signal": finite_number(signal_line.iloc[index]) if index >= 33 else None,
                    "histogram": finite_number(histogram.iloc[index]) if index >= 33 else None,
                }
            )

        last_date = date_label(frame.index[-1])
        last_close = finite_number(frame.iloc[-1]["Close"])
        return {
            "symbol": symbol,
            "name": item["name"],
            "state": freshness_for(last_date),
            "error": None,
            "source": SOURCE,
            "updatedAt": retrieved_at,
            "lastTradingDate": last_date,
            "candles": candles,
            "support": swing_levels(frame, "Low", "support", last_close or 0),
            "resistance": swing_levels(frame, "High", "resistance", last_close or 0),
        }
    except Exception as error:
        return {
            "symbol": symbol,
            "name": item["name"],
            "state": "unavailable" if isinstance(error, NoDataAvailableError) else "failed",
            "error": error_text(error),
            "source": SOURCE,
            "updatedAt": retrieved_at,
            "lastTradingDate": None,
            "candles": [],
            "support": [],
            "resistance": [],
        }


def internet_check() -> dict[str, Any]:
    checked_at = now_iso()
    try:
        request = urllib.request.Request(
            "https://example.com/",
            headers={"User-Agent": "IDX-Radar-connectivity-test/1.0"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            status = response.status
        if status >= 400:
            raise urllib.error.HTTPError("https://example.com/", status, f"HTTP {status}", response.headers, None)
        return {
            "status": "success",
            "message": f"Koneksi internet server merespons HTTP {status}.",
            "error": None,
            "checkedAt": checked_at,
        }
    except Exception as error:
        return {
            "status": "failed",
            "message": "Server tidak berhasil menjangkau example.com.",
            "error": error_text(error),
            "checkedAt": checked_at,
        }


def ticker_test(symbol: str) -> dict[str, Any]:
    ticker = f"{symbol}.JK"
    try:
        frame = history_for(symbol, "5d")
        last_date = date_label(frame.index[-1])
        close = finite_number(frame.iloc[-1]["Close"])
        if close is None:
            raise ValueError(f"Yahoo Finance returned no numeric closing price for {ticker}.")
        return {
            "symbol": ticker,
            "status": "success",
            "rows": len(frame),
            "lastTradingDate": last_date,
            "close": close,
            "error": None,
        }
    except Exception as error:
        return {
            "symbol": ticker,
            "status": "failed",
            "rows": 0,
            "lastTradingDate": None,
            "close": None,
            "error": error_text(error),
        }


def diagnostics() -> dict[str, Any]:
    internet = internet_check()
    tickers = [ticker_test(symbol) for symbol in ("BBCA", "BBRI")]
    failures = [f"{result['symbol']}: {result['error']}" for result in tickers if result["status"] != "success"]
    if failures:
        yahoo = {
            "status": "failed",
            "message": f"Pengambilan data Yahoo Finance gagal untuk {len(failures)} dari 2 ticker.",
            "error": "\n".join(failures),
            "checkedAt": now_iso(),
        }
    else:
        yahoo = {
            "status": "success",
            "message": "Pengambilan data Yahoo Finance berhasil untuk BBCA.JK dan BBRI.JK.",
            "error": None,
            "checkedAt": now_iso(),
        }
    return {
        "source": SOURCE,
        "testedAt": now_iso(),
        "internet": internet,
        "yahoo": yahoo,
        "tickers": tickers,
    }


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = json.loads(sys.stdin.read() or "{}")

    if action == "symbols":
        result = SYMBOLS
    elif action == "scanner":
        result = scanner()
    elif action == "stock":
        symbol = str(payload.get("symbol", "")).upper()
        result = stock_detail(symbol)
    elif action == "diagnostics":
        result = diagnostics()
    else:
        raise ValueError(f"Unsupported market data action: {action}")

    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()