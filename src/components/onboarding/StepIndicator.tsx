"use client";

interface StepIndicatorProps {
  current: number;
  total: number;
}

export function StepIndicator({ current, total }: StepIndicatorProps) {
  const percent = Math.round(((current - 1) / (total - 1)) * 100);

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-400">
          Étape <span className="text-white font-semibold">{current}</span> sur{" "}
          <span className="text-white font-semibold">{total}</span>
        </span>
        <span className="text-sm text-slate-400">{percent}%</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {/* Dot indicators */}
      <div className="flex justify-between mt-2">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
              i + 1 < current
                ? "bg-blue-500"
                : i + 1 === current
                ? "bg-blue-400 ring-2 ring-blue-400/30"
                : "bg-slate-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
