"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleRow } from "@/lib/api";
import { fmtUsd } from "@/lib/api";

const TOKEN_SUPPLY = 1_000_000_000;

export function TradingViewCandleChart({ candles, usdRate }: { candles: CandleRow[]; usdRate: number }) {
  const container = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  const volumeSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const chart = createChart(element, {
      width: element.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#89928a",
      },
      grid: {
        vertLines: { color: "rgba(137, 146, 138, 0.12)" },
        horzLines: { color: "rgba(137, 146, 138, 0.12)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (price: number) => fmtUsd(price) },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#a8c879",
      downColor: "#d87868",
      borderUpColor: "#a8c879",
      borderDownColor: "#d87868",
      wickUpColor: "#a8c879",
      wickDownColor: "#d87868",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
      borderVisible: false,
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        const width = Math.floor(entry.contentRect.width);
        const height = Math.max(280, Math.min(380, Math.round(width * 0.52)));
        element.style.height = `${height}px`;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;

    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
    candleSeries.setData(sortedCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open * usdRate * TOKEN_SUPPLY,
      high: candle.high * usdRate * TOKEN_SUPPLY,
      low: candle.low * usdRate * TOKEN_SUPPLY,
      close: candle.close * usdRate * TOKEN_SUPPLY,
    })));
    volumeSeries.setData(sortedCandles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.volumeEth * usdRate,
      color: candle.close >= candle.open ? "rgba(168, 200, 121, 0.34)" : "rgba(216, 120, 104, 0.3)",
    })));
    chart.timeScale().fitContent();
  }, [candles, usdRate]);

  return (
    <div className="tradingview-candle-chart" ref={container} style={{ height: 360, width: "100%" }} aria-label="Token market capitalization candlestick chart" />
  );
}
