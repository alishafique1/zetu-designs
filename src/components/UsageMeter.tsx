/**
 * UsageMeter — shows generation usage progress bar or BYOK status.
 * Color coding: green < 70%, yellow 70-90%, red > 90%
 */
import React from 'react';

interface Props {
  used: number;
  limit: number;
  mode: 'zetu' | 'byok';
}

export function UsageMeter({ used, limit, mode }: Props) {
  if (mode === 'byok') {
    return <span className="usage-meter-byok">Using your API key</span>;
  }

  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';

  return (
    <div className="usage-meter">
      <div className="usage-meter-label">
        <span>{used} / {limit} generations used</span>
        <span className="usage-meter-pct">{Math.round(pct)}%</span>
      </div>
      <div className="usage-meter-track">
        <div
          className={`usage-meter-fill usage-meter-${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
