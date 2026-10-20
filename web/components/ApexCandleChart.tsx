"use client";

import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { fmtUsd, type CandleRow } from "@/lib/api";

export function ApexCandleChart({ candles, usdRate }: { candles: CandleRow[]; usdRate: number }) {
  const seriesData = candles.map((candle) => ({
    x: new Date(candle.time * 1000),
    y: [candle.open * usdRate, candle.high * usdRate, candle.low * usdRate, candle.close * usdRate],
  }));
  if (candles.length === 0) return <div className="empty-trades">No candles for this interval yet.</div>;
  const currentPrice = candles[candles.length - 1]?.close * usdRate;
  const candleLows = candles.map((candle) => candle.low * usdRate);
  const candleHighs = candles.map((candle) => candle.high * usdRate);
  const rawMin = Math.min(...candleLows), rawMax = Math.max(...candleHighs);
  const pricePadding = Math.max((rawMax - rawMin) * 0.08, Math.abs(currentPrice) * 0.002, 1e-12);
  const priceMin = rawMin - pricePadding, priceMax = rawMax + pricePadding;
  const priceOptions: ApexOptions = {
    chart: {
      type: "candlestick",
      id: "token-price-candles",
      height: 340,
      background: "transparent",
      foreColor: "#89928a",
      toolbar: { show: false },
      zoom: { enabled: true, type: "x", autoScaleYaxis: true },
      animations: { enabled: false },
    },
    theme: { mode: "dark" },
    plotOptions: {
      candlestick: {
        colors: { upward: "#00c805", downward: "#ff5a00" },
        wick: { useFillColor: true },
      },
    },
    grid: { borderColor: "#2c342e", strokeDashArray: 3, xaxis: { lines: { show: true } }, padding: { left: 6, right: 12, bottom: -8 } },
    xaxis: {
      type: "datetime",
      labels: { show: false },
      axisBorder: { color: "#2c342e" },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      min: priceMin,
      max: priceMax,
      tooltip: { enabled: false },
      labels: {
        minWidth: 70,
        formatter: (value) => fmtUsd(value),
        style: { colors: "#89928a", fontFamily: "DM Mono, monospace", fontSize: "10px" },
      },
    },
    tooltip: {
      theme: "dark",
      x: { format: "dd MMM yyyy HH:mm" },
      y: { formatter: (value) => fmtUsd(value) },
    },
    annotations: {
      yaxis: [{
        y: currentPrice,
        borderColor: "#ff5a00",
        strokeDashArray: 4,
        label: {
          text: fmtUsd(currentPrice),
          position: "right",
          borderColor: "#ff5a00",
          offsetX: 8,
          style: { color: "#111311", background: "#ff5a00", fontSize: "12px", fontWeight: 600 },
        },
      }],
    },
    stroke: { width: 1 },
    dataLabels: { enabled: false },
  };
  const volumeOptions: ApexOptions = {
    chart: {
      type: "bar",
      id: "token-trade-volume",
      height: 112,
      background: "transparent",
      foreColor: "#89928a",
      toolbar: { show: false },
      zoom: { enabled: true, type: "x", autoScaleYaxis: true },
      stacked: true,
      animations: { enabled: false },
    },
    theme: { mode: "dark" },
    colors: ["#00c805", "#ff5a00"],
    legend: { show: false },
    plotOptions: { bar: { columnWidth: "72%" } },
    grid: { borderColor: "#2c342e", strokeDashArray: 3, padding: { left: 6, right: 12, top: -10 } },
    xaxis: {
      type: "datetime",
      labels: { datetimeUTC: false, style: { colors: "#89928a", fontFamily: "DM Mono, monospace", fontSize: "10px" } },
      axisBorder: { color: "#2c342e" },
      axisTicks: { color: "#2c342e" },
      tooltip: { enabled: false },
    },
    yaxis: {
      min: 0,
      labels: { show: true, minWidth: 70, maxWidth: 70, formatter: () => "", style: { colors: "transparent" } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    tooltip: {
      theme: "dark",
      x: { format: "dd MMM yyyy HH:mm" },
      y: { formatter: (value) => `${fmtUsd(value)} volume` },
    },
    dataLabels: { enabled: false },
  };
  const volumePoints = candles.map((candle) => ({
      x: new Date(candle.time * 1000),
      y: candle.volumeEth * usdRate,
    }));
  const volumeSeries = [
    { name: "Up volume", data: volumePoints.map((point, index) => ({ ...point, y: candles[index].close >= candles[index].open ? point.y : null })) },
    { name: "Down volume", data: volumePoints.map((point, index) => ({ ...point, y: candles[index].close < candles[index].open ? point.y : null })) },
  ];

  return (
    <div className="apex-market-chart">
      <Chart options={priceOptions} series={[{ data: seriesData }]} type="candlestick" height={340} />
      <Chart options={volumeOptions} series={volumeSeries} type="bar" height={112} />
    </div>
  );
}
